'use strict';

var fs = require("fs");
var path = require("path");
var join = path.join;
var crypto = require("crypto");
var RSA = require('node-rsa');
var wrench = require("wrench");
var archiver = require("archiver");
var rm = require('rimraf');
var Promise = require('es6-promise').Promise;

function ChromeExtension(attrs) {
  if ((this instanceof ChromeExtension) !== true) {
    return new ChromeExtension(attrs);
  }

  /*
   Defaults
   */
  this.appId = null;

  this.manifest = '';

  this.loaded = false;

  this.rootDirectory = '';

  this.publicKey = null;

  this.privateKey = null;

  this.codebase = null;

  /*
  Copying attributes
   */
  for (var name in attrs) {
    this[name] = attrs[name];
  }

  this.path = join("tmp", "crx-" + (Math.random() * 1e17).toString(36))
}

ChromeExtension.prototype = {

  /**
   * Destroys generated files.
   *
   * @returns {Promise}
   */
  destroy: function () {
    var path = this.path;

    return new Promise(function(resolve, reject){
      rm(path, function(err){
        if (err){
          return reject(err);
        }

        resolve();
      });
    });
  },

  /**
   * Packs the content of the extension in a crx file.
   *
   * @returns {Promise}
   * @example
   *
   * crx.pack().then(function(crxContent){
   *  // do something with the crxContent binary data
   * });
   *
   */
  pack: function () {
    if (!this.loaded) {
      return this.load().then(this.pack.bind(this));
    }

    var selfie = this;

    return selfie.writeFile("manifest.json", JSON.stringify(selfie.manifest))
      .then(this.generatePublicKey.bind(this))
      .then(function(publicKey){
        selfie.publicKey = publicKey;

        return selfie.loadContents().then(function (contents) {
          var signature = selfie.generateSignature(contents);

          return selfie.generatePackage(signature, publicKey, contents);
        })
      });
  },

  /**
   * Loads extension manifest and copies its content to a workable path.
   *
   * @param {string=} path
   * @returns {Promise}
   */
  load: function (path) {
    if (!fs.existsSync("tmp")) {
      fs.mkdirSync("tmp");
    }

    var selfie = this;

    return new Promise(function(resolve, reject){
      wrench.copyDirRecursive(path || selfie.rootDirectory, selfie.path, function (err) {
        if (err) {
          return reject(err);
        }

        selfie.manifest = require(join(process.cwd(), selfie.path, "manifest.json"));
        selfie.loaded = true;

        resolve(selfie);
      });
    });
  },

  /**
   * Writes data into the extension workable directory.
   *
   * @param {string} path
   * @param {*} data
   * @returns {Promise}
   */
  writeFile: function (path, data) {
    var absPath = join(this.path, path);

    return new Promise(function(resolve, reject){
      fs.writeFile(absPath, data, function (err) {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  },

  /**
   * Generates a public key.
   *
   * BC BREAK `this.publicKey` is not stored anymore (since 1.0.0)
   *
   * @returns {Promise}
   * @example
   *
   * crx.generatePublicKey(function(publicKey){
   *   // do something with publicKey
   * });
   */
  generatePublicKey: function () {
    var privateKey = this.privateKey;

    return new Promise(function(resolve, reject){
      var key = new RSA(privateKey, 'pkcs1-private-pem');

      resolve(key.exportKey('pkcs8-public-der'));
    });
  },

  /**
   * Generates a SHA1 package signature.
   *
   * BC BREAK `this.signature` is not stored anymore (since 1.0.0)
   *
   * @param {Buffer} contents
   * @returns {Buffer}
   */
  generateSignature: function (contents) {
    return new Buffer(
      crypto
        .createSign("sha1")
        .update(contents)
        .sign(this.privateKey),
      "binary"
    );
  },

  /**
   *
   * BC BREAK `this.contents` is not stored anymore (since 1.0.0)
   *
   * @returns {Promise}
   */
  loadContents: function () {
    var archive = archiver("zip");
    var selfie = this;

    return new Promise(function(resolve, reject){
      var contents = new Buffer('');
      var allFiles = [];

      // the callback is called many times
      // when 'files' is null, it means we accumulated everything
      // hence this weird setup
      wrench.readdirRecursive(selfie.path, function(err, files){
        if (err){
          return reject(err);
        }

        // stack unless 'files' is null
        if (files){
          allFiles = allFiles.concat(files);
          return;
        }

        allFiles.forEach(function (file) {
          var filePath = join(selfie.path, file);
          var stat = fs.statSync(filePath);

          if (stat.isFile() && file !== "key.pem") {
            archive.append(fs.createReadStream(filePath), { name: file });
          }
        });

        archive.finalize();

        // Relates to the issue: "Event 'finished' no longer valid #18"
        // https://github.com/jed/crx/issues/18
        // TODO: Buffer concat could be a problem when building a big extension.
        //       So ideally only the 'finish' callback must be used.
        archive.on('readable', function () {
          contents = Buffer.concat([contents, archive.read()]);
        });

        archive.on('finish', function () {
          resolve(contents);
        });

        archive.on("error", reject);
      });
    });
  },

  /**
   * Generates and returns a signed package from extension content.
   *
   * BC BREAK `this.package` is not stored anymore (since 1.0.0)
   *
   * @param {Buffer} signature
   * @param {Buffer} publicKey
   * @param {Buffer} contents
   * @returns {Buffer}
   */
  generatePackage: function (signature, publicKey, contents) {
    var keyLength = publicKey.length;
    var sigLength = signature.length;
    var zipLength = contents.length;
    var length = 16 + keyLength + sigLength + zipLength;

    var crx = new Buffer(length);

    crx.write("Cr24" + Array(13).join("\x00"), "binary");

    crx[4] = 2;
    crx.writeUInt32LE(keyLength, 8);
    crx.writeUInt32LE(sigLength, 12);

    publicKey.copy(crx, 16);
    signature.copy(crx, 16 + keyLength);
    contents.copy(crx, 16 + keyLength + sigLength);

    return crx;
  },

  /**
   * Generates an appId from the publicKey.
   *
   * BC BREAK `this.appId` is not stored anymore (since 1.0.0)
   *
   * @returns {string}
   */
  generateAppId: function () {
    return crypto
      .createHash("sha256")
      .update(this.publicKey)
      .digest("hex")
      .slice(0, 32)
      .replace(/./g, function (x) {
        return (parseInt(x, 16) + 10).toString(26);
      });
  },

  /**
   * Generates an updateXML file from the extension content.
   *
   * BC BREAK `this.updateXML` is not stored anymore (since 1.0.0)
   *
   * @returns {Buffer}
   */
  generateUpdateXML: function () {
    if (!this.codebase) {
      throw new Error("No URL provided for update.xml.");
    }

    return Buffer(
      "<?xml version='1.0' encoding='UTF-8'?>\n" +
      "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n" +
      "  <app appid='" + (this.appId || this.generateAppId()) + "'>\n" +
      "    <updatecheck codebase='" + this.codebase + "' version='" + this.manifest.version + "' />\n" +
      "  </app>\n" +
      "</gupdate>"
    );
  }
};

module.exports = ChromeExtension;
