var path = require('path');

var mainDir  = path.resolve(__dirname, '../web/');
var iconDir  = path.resolve(mainDir, '_thumbs/');
var metaFile = path.resolve(mainDir, '_meta.json');
var iconSize = 256;

var fs = require('fs');
var gm = require('gm');
var async = require('async');
var ffmpeg = require('fluent-ffmpeg')
var mustache = require('mustache');
var template = fs.readFileSync(path.resolve(__dirname, 'template.html'), 'utf8');

var metaData = {};
if (fs.existsSync(metaFile)) metaData = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

var todoFiles = [];
var todoFolders = [];

scanDirectory('');

async.series(todoFiles, function () {
	async.series(todoFolders, function () {
		console.log('Finished');
	})
})

function saveMeta() {
	fs.writeFileSync(metaFile, JSON.stringify(metaData, null, '\t'), 'utf8');
}

function scanDirectory(folder) {
	parseFolder(folder);

	var mainFol = path.resolve(mainDir, folder);
	fs.readdirSync(mainFol).forEach(function (filename) {
		if (filename[0] == '_') return;

		filename = path.join(folder,filename);

		var mainFile = path.resolve(mainDir, filename);
		var stat = fs.statSync(mainFile);

		if (stat.isDirectory()) {
			scanDirectory(filename);
		} else {
			var extension = filename.split('.').pop().toLowerCase();
			switch (extension) {
				case 'ds_store':
				case 'html':
					// ignore
				break;
				case 'jpg':
				case 'png':
				case 'psd':
					// image
					parseImage(filename);
				break;
				case 'mov':
				case 'mp4':
				case 'wmv':
					// image
					parseMovie(filename);
				break;
				case '7z':
				case 'json':
				case 'svg':
				case 'pdf':
					// other
					parseOther(filename);
				break;
				default:
					throw new Error('Unknown extension "'+extension+'"');
			}
		}
	})
}

function parseFolder(filename) {
	var node = getNode(filename);

	var mainFile = path.resolve(mainDir, filename, 'index.html');

	if (!node.type) node.type = 'folder';

	node.url = path.resolve('/', filename, 'index.html');

	todoFolders.push(function (cb) {
		console.info('iconize "'+filename+'"');
		var iconFilename = path.join(filename, '_folder.jpg');
		var fullIconFilename = path.resolve(iconDir, iconFilename);
		ensureFolder(path.dirname(fullIconFilename));

		var imageList = getThumbsRecursive(node);
		if (imageList.length < 1) throw Error();
		var cols = Math.floor(Math.sqrt(imageList.length));
		var n = cols*cols;
		
		var img = gm()
			.command('montage')
			.background('#FFFFFF')
			.in('-geometry', iconSize+'x'+iconSize+'+0+0')
			.in('-tile', cols+'x'+cols);

		for (var i = 0; i < n; i++) {
			var index = Math.floor(i*(imageList.length-1)/(n-0.999999)+0.5);
			img.in(imageList[index].filename);
		}

		img.resize(iconSize, iconSize)
			.quality(95)
			.write(fullIconFilename, function (err) {
				if (err) throw new Error(err);
				node.icon = iconFilename;
				saveMeta();

				var html = mustache.render(template, {
					title: path.basename(filename),
					backUrl: node.parent ? node.parent.url : false;
					entries: Object.keys(node.children).map(function (key) {
						var subNode = node.children[key];
						return {
							class: subNode.type,
							url: path.basename(subNode.filename),
							thumbUrl: '/'+subNode.icon.replace(/ /g, '%20'),
							info: subNode.info ? subNode.info.join('<br>') : false,
							text: path.basename(subNode.filename)
						}
					})
				});

				fs.writeFileSync(mainFile, html, 'utf8');

				cb();
			})
	})

	function getThumbsRecursive(node) {
		var list = [];
		Object.keys(node.children).forEach(function (key) {
			var subNode = node.children[key];
			if (subNode.type == 'folder') {
				list = list.concat(getThumbsRecursive(subNode))
			} else {
				if (subNode.icon) list.push({filename:path.resolve(iconDir, subNode.icon)});
			}
		})
		return list;
	}
}

function parseImage(filename) {
	var node = getNode(filename);

	var mainFile = path.resolve(mainDir, filename);
	var stat = fs.statSync(mainFile);
	var mtime = stat.mtime.toISOString();

	if (mtime != node.mtime) {
		node.mtime = mtime;
		node.meta = false;
		node.icon = false;
	}

	if (!node.type) node.type = 'image';

	if (!node.meta) {
		todoFiles.push(function (cb) {
			console.info('identify "'+filename+'"');
			gm(mainFile).size(function (err, data) {
				node.meta = data;
				node.info = [data.width+'x'+data.height, (stat.size/1048576).toFixed(1)+' MB'];
				cb();
			})
		})
	}

	if (!node.icon) {
		todoFiles.push(function (cb) {
			console.info('iconize "'+filename+'"');
			var iconFilename = filename+'.jpg';
			var fullIconFilename = path.resolve(iconDir, iconFilename);
			ensureFolder(path.dirname(fullIconFilename));
			gm(mainFile)
				.resize(iconSize, iconSize)
				.background('#FFFFFF')
				.gravity('Center')
				.extent(iconSize, iconSize)
				.quality(95)
				.write(fullIconFilename, function (err) {
					if (err) throw new Error(err);
					node.icon = iconFilename;
					saveMeta();
					cb();
				})
		})
	}
}

function parseMovie(filename) {
	var node = getNode(filename);

	var mainFile = path.resolve(mainDir, filename);
	var stat = fs.statSync(mainFile);
	var mtime = stat.mtime.toISOString();

	if (mtime != node.mtime) {
		node.mtime = mtime;
		node.meta = false;
		node.icon = false;
	}

	if (!node.type) node.type = 'movie';

	if (!node.meta) {
		todoFiles.push(function (cb) {
			console.info('identify "'+filename+'"');
			ffmpeg.ffprobe(mainFile, function (err, data) {
				var stream = data.streams.filter(function (s) { return s.codec_type == 'video' });
				if (stream.length != 1) throw Error();
				stream = stream[0];
				node.meta = {
					width: stream.width,
					height: stream.height,
					codec: stream.codec_name,
					framerate: parseFloat(stream.r_frame_rate),
					duration: stream.duration
				}
				node.info = [
					stream.width+'x'+stream.height+' '+node.meta.framerate+'fps',
					node.meta.codec+', '+stream.duration+'s',
					(stat.size/1048576).toFixed(1)+' MB'
				];
				cb();
			})
		})
	}

	if (!node.icon) {

		todoFiles.push(function (cb) {
			console.info('iconize "'+filename+'"');

			var iconFilename = filename+'.png';
			var fullIconFilename = path.resolve(iconDir, iconFilename);
			ensureFolder(path.dirname(fullIconFilename));

			var thumbCols = 4;
			var thumbRows = Math.ceil(thumbCols*node.meta.width/node.meta.height);
			var thumbCount = thumbCols*thumbRows;
			var skip = node.meta.duration*node.meta.framerate/(thumbCount+1);

			ffmpeg(mainFile)
				.seekInput(node.meta.duration*0.5/(thumbCount+1))
				.videoFilter('fps='+(thumbCount+1)/node.meta.duration)
				.videoFilter('format=bgr24')
				.videoFilter('format=rgb24')
				.videoFilter('scale='+(iconSize/thumbCols)+':-1')
				.videoFilter('tile='+thumbCols+'x'+thumbRows)
				.videoFilter('crop='+iconSize+':'+iconSize)
				.frames(1)
				.noAudio()
				.save(fullIconFilename)
				.on('error', function(err)	{ throw err })
				.on('end', function () {
					node.icon = iconFilename;
					saveMeta();
					cb();
				})
		})
	}
}



function parseOther(filename) {
	var node = getNode(filename);

	var mainFile = path.resolve(mainDir, filename);

	if (!node.type) node.type = 'other';

	if (!node.icon) {
		todoFiles.push(function (cb) {
			console.info('iconize "'+filename+'"');
			var iconFilename = filename+'.png';
			var fullIconFilename = path.resolve(iconDir, iconFilename);
			ensureFolder(path.dirname(fullIconFilename));
			gm(iconSize, iconSize, '#FFF')
				.fill('#444')
				.font('/System/Library/Fonts/HelveticaNeue.dfont')
				.fontSize(iconSize*0.3)
				.drawText(0, 0, filename.split('.').pop().toUpperCase(), 'Center')
				.write(fullIconFilename, function (err) {
					if (err) throw new Error(err);
					node.icon = iconFilename;
					saveMeta();
					cb();
				})
		})
	}
}

function getNode(filename) {
	var parts = filename.split('/');
	var node = metaData;
	if (!node.children) node.children = {};

	if (filename != '') {
		parts.forEach(function (part) {
			if (!node.children[part]) node.children[part] = {children:{}};
			node = node.children[part];
		})
	}

	if (node.icon && !fs.existsSync(path.resolve(iconDir, node.icon))) node.icon = false;
	node.filename = filename;

	return node;
}

function ensureFolder(folder) {
	if (!fs.existsSync(folder)) {
		ensureFolder(path.dirname(folder));
		fs.mkdirSync(folder);
	}
}

/*




fs.readdirSync(path).sort().forEach(function (projectName) {
	folder = path+'/'+projectName;
	var stat = fs.statSync(folder);
	if (stat.isDirectory()) {

		if (!fs.existsSync(thumbFolder)) fs.mkdirSync(thumbFolder);
		if (!fs.existsSync(metaFolder) ) fs.mkdirSync(metaFolder);

		var images = scanImages(imageFolder, thumbFolder, metaFolder);
		var movies = scanMovies(movieFolder, thumbFolder, metaFolder);

		templates.push({
			backlink: '../index.html',
			title:  projectName,
			images: images,
			movies: movies,
			filename: folder+'/index.html'
		});

		index.push({
			text:     projectName,
			thumbSrc: projectName+'/'+images[0].thumbSrc,
			href:     projectName+'/index.html',
			target:   '_self'
		});
	}
})

templates.push({
	title: 'Projekte',
	images: index,
	filename: path+'/index.html'
})

function next() {
	if (todos.length <= 0) {
		finalize();
		return;
	}
	var todo = todos.shift();
	console.log(todo.task + ': ' + todo.fr + ' -> ' + todo.to);

	switch (todo.task) {
		case 'image_thumb':
			gm(todo.fr).filter('Box').resize(480, 480, '').quality(90).write(todo.to, check);
		break;
		case 'image_info':
			var info = {};
			var stat = fs.statSync(todo.fr);
			info.size = (stat.size/1048576).toFixed(1)+' MB';
			child_process.exec('identify '+todo.fr, function (a,data) {
				var t = data.match(/[0-9]+x[0-9]+/)[0];
				t = t.split('x');
				info.width  = parseFloat(t[0]);
				info.height = parseFloat(t[1]);

				fs.writeFileSync(todo.to, JSON.stringify(info), 'utf8');

				todo.image.info = info;

				check()
			});
		break;
		case 'movie_thumb':
			var fps = 10/todo.info.duration;
			var m = Math.max(todo.info.width, todo.info.height);
			var width  = Math.round(480*todo.info.width  / m);
			var height = Math.round(480*todo.info.height / m);
			var offsetX = Math.round((480-width )/2);
			var offsetY = Math.round((480-height)/2);
			var filter = 'scale='+width+'x'+height+',pad=width=480:height=480:x='+offsetX+':y='+offsetY+':color=0xFFFFFF';
			for (var i = 0; i <= 20; i++) {
				var t = (i+1)*todo.info.duration/22;
				var command = 'ffmpeg -ss '+t+' -i '+todo.fr+' -frames:v 1 -vf "'+filter+'" '+todo.to+i+'.png';	
				var newTodo = {
					task: 'command',
					command: command,
					fr: todo.fr,
					to: todo.to+i+'.png'
				}
				if (i == 20) newTodo.callback = todo.callback;
				todos.push(newTodo);
			}
			todo.callback = false;
			check();
		break;
		case 'command':
			child_process.exec(todo.command, function (e) {
				if (e) {
					console.error(todo.command);
					console.error(e);
					process.exit();
				}
				check();
			})
		break;
		case 'movie_info':
			child_process.exec('ffprobe -v quiet -print_format json -show_format -show_streams '+todo.fr, function (a,data) {
				data = JSON.parse(data);

				var info = {};
				info.duration = Math.round(parseFloat(data.format.duration));
				info.size = (parseFloat(data.format.size)/1048576).toFixed(1)+' MB';

				console.log(data);
				data.streams.forEach(function (stream) {
					if (stream.codec_type == 'video') {
						info.width = stream.width.toFixed(0);
						info.height = stream.height.toFixed(0);
						info.fps = parseFloat(stream.r_frame_rate.split('/').shift()).toFixed(0);
						info.codec = stream.codec_name.toUpperCase();
					}
				})

				fs.writeFileSync(todo.to, JSON.stringify(info), 'utf8');

				todo.movie.info = info;

				check();
			});
		break;
		default:
			console.error('Unknown Task: ' + todo.task);
			check();
	}

	function check() {
		if (todo.callback) todo.callback();
		setTimeout(next, 0);
	}
}
next();

function finalize() {

	var template = fs.readFileSync('template.html', 'utf8');

	templates.forEach(function (data) {
		if (data.movies) data.movies.forEach(function (movie) {
			var info = movie.info;
			info._duration = (info.duration < 100) ? info.duration+'sec' : Math.round(info.duration/60)+'min';
		})


		var html = Mustache.render(
			template,
			data
		)
		fs.writeFileSync(data.filename, html, 'utf8');
	});

	console.log('Finished');
}

function scanImages(folder, thumbFolder, metaFolder) {
	var images = [];

	fs.readdirSync(folder).sort().forEach(function (filename) {
		var name = filename.split('.');
		var extension = name.pop().toLowerCase();
		if ('png,jpg,jpeg'.indexOf(extension) >= 0) {
			var thumbName = 'image_' + filename + '.jpg';
			var metaName  = 'image_' + filename + '.json';

			var image = {
				thumbSrc:  'thumbs/' + thumbName,
				text:       filename,
				href:      'images/' + filename
			}

			if (!fs.existsSync(metaFolder + metaName)) {
				todos.push({
					task: 'image_info',
					fr: folder + filename,
					to: metaFolder + metaName,
					image: image
				})
			} else {
				image.info = JSON.parse(fs.readFileSync(metaFolder + metaName, 'utf8'));
			}

			if (!fs.existsSync(thumbFolder + thumbName)) {
				todos.push({
					task: 'image_thumb',
					fr: folder + filename,
					to: thumbFolder + thumbName
				})
			}

			images.push(image)
		}
	})

	return images;
}

function scanMovies(folder, thumbFolder, metaFolder) {
	var movies = [];

	if (!fs.existsSync(folder)) return movies;

	fs.readdirSync(folder).sort().forEach(function (filename) {
		var name = filename.split('.');
		var extension = name.pop().toLowerCase();
		if ('mp4,mov,wmv'.indexOf(extension) >= 0) {
			var thumbName = 'movie_' + filename + '_';
			var metaName  = 'movie_' + filename + '.json';

			var movie = {
				thumbSrc:  'thumbs/' + thumbName + '0.png',
				thumbTmp:  'thumbs/' + thumbName,
				text:       filename,
				href:      'movies/' + filename
			};

			if (!fs.existsSync(metaFolder + metaName)) {
				todos.push({
					task: 'movie_info',
					fr: folder + filename,
					to: metaFolder + metaName,
					movie: movie,
					callback: makeThumb
				})
			} else {
				movie.info = JSON.parse(fs.readFileSync(metaFolder + metaName, 'utf8'));
				makeThumb();
			}

			function makeThumb() {
				if (!fs.existsSync(thumbFolder + thumbName + '0.png')) {
					todos.push({
						task: 'movie_thumb',
						fr: folder + filename,
						to: thumbFolder + thumbName,
						info: movie.info
					})
				}
			}

			movies.push(movie)
		}
	})

	return movies;
}

/*
rsync --delete-after -avzhtPe ssh /Users/michaelkreil/Documents/Projekte/highres-screenshots/web/ root@nyx.opendatacloud.de:/var/www/opendatacity.de/docs/download/highres
*/


