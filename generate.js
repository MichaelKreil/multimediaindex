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
var imageLib = ImageLib();
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
					backUrl: node.parent ? node.parent.url : false,
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
			imageLib.generateIcon(
				mainFile,
				fullIconFilename,
				function () {
					node.icon = iconFilename;
					saveMeta();
					cb();
				}
			);
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
			imageLib.createMovieIcon(
			)
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
			imageLib.createTextIcon(
				filename.split('.').pop().toUpperCase(),
				fullIconFilename,
				function () {
					node.icon = iconFilename;
					saveMeta();
					cb();
				}
			)
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

function ImageLib() {
	return {
		createTextIcon: function (text, filename, cb) {
			gm(iconSize, iconSize, '#FFF')
				.fill('#444')
				.font('/System/Library/Fonts/HelveticaNeue.dfont')
				.fontSize(iconSize*0.3)
				.drawText(0, 0, text, 'Center')
				.write(filename, function (err) {
					if (err) throw new Error(err);
					cb();
				})
		},
		createImageIcon: function (image, filename, cb) {
			gm(image)
				.resize(iconSize, iconSize)
				.background('#FFFFFF')
				.gravity('Center')
				.extent(iconSize, iconSize)
				.quality(95)
				.write(filename, function (err) {
					if (err) throw new Error(err);
					cb();
				})
		},
		createMovieIcon: function (movie, filename, cb) {
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
		}
	}
}

function ensureFolder(folder) {
	if (!fs.existsSync(folder)) {
		ensureFolder(path.dirname(folder));
		fs.mkdirSync(folder);
	}
}

/*
rsync --delete-after -avzhtPe ssh /Users/michaelkreil/Documents/Projekte/highres-screenshots/web/ root@nyx.opendatacloud.de:/var/www/opendatacity.de/docs/download/highres
*/


