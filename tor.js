/* globals EventEmitter */
'use strict';

var Native = function () {
  this.callback = null;
  this.channel = chrome.runtime.connectNative('com.add0n.node');

  function onDisconnect () {
    chrome.tabs.create({
      url: '/data/helper/index.html'
    });
  }

  this.channel.onDisconnect.addListener(onDisconnect);
  this.channel.onMessage.addListener(res => {
    if (res && res.stdout && res.stdout.type === 'Buffer') {
      res.stdout = {
        data: String.fromCharCode.apply(String, res.stdout.data),
        type: 'String'
      };
    }

    if (!res) {
      chrome.tabs.create({
        url: '/data/helper/index.html'
      });
    }
    else if (this.callback) {
      this.callback(res);
    }
  });
};
Native.prototype.exec = function (command, args, callback = function () {}) {
  this.callback = function (res) {
    callback(res);
  };
  this.channel.postMessage({
    cmd: 'exec',
    command,
    arguments: args
  });
};

var Tor = function (options) {
  this.callback = this.response;
  EventEmitter.call(this);
  this.directory = options.directory;
  this.callbacks = [];

  this.info = {
    status: 'disconnected',
    password: options.password || 'tor-browser',
    stdout: 'Press the switch button to get started',
    stderr: '',
    progress: 0,
    ip: '0.0.0.0',
    'socks-host': 'localhost',
    'socks-port': 22050,
    'control-port': 22051
  };

  this.on('stdout', m => {
    this.info.stdout += m;
  });
  this.on('status', s => {
    this.info.status = s;
  });
  this.on('progress', o => {
    this.info.progress = o.value;
    if (o.value === 100) {
      this.emit('status', 'connected');
    }
  });
};
Tor.prototype = Object.create(Native.prototype);
Tor.prototype = Object.create(EventEmitter.prototype);

Tor.prototype.response = function (res) {
  this.callbacks.forEach(c => c(res));
  if (res.code) {
    this.emit('status', 'disconnected');

    if (res.code !== 0 && (res.code !== 1 || res.stderr !== '')) {
      window.alert(`Something went wrong!

-----
Code: ${res.code}
Output: ${res.stdout}
Error: ${res.stderr}`
      );
    }
  }

  if (res.stdout) {
    this.emit('stdout', res.stdout.data);
  }
  if (res.stderr) {
    this.emit('stderr', res.stdout.data);
  }

  if (res.stdout) {
    res.stdout.data.split('\n').forEach(data => {
      let err = /\[(err|warn|notice)\] (.*)/.exec(data);
      if (err) {
        this.emit('console', {
          type: err[1],
          msg: err[2]
        });
      }

      let progress = /Bootstrapped (\d+)%\: (.*)/.exec(data);
      if (progress) {
        this.emit('progress', {
          value: +progress[1],
          msg: progress[2]
        });
      }
    });
  }
};

Tor.prototype.connect = function () {
  this.emit('status', 'connecting');
  this.channel.postMessage({
    cmd: 'spawn',
    command: [this.directory, 'tor'],
    arguments: ['-f', 'torrc'],
    properties: {
      detached: false,
      cwd: this.directory
    },
    kill: true
  });
};

Tor.prototype.refresh = function () {
  Native.call(this);
  this.callback = this.response;
  this.stdout = 'Press the switch button to get started';
  this.stderr = '';
  this.connect();
};

Tor.prototype.command = function (command, callback = function () {}) {
  let commands = [
    `AUTHENTICATE "${this.info.password}"\r\n`, // Chapter 3.5
    command + '\r\n',
    'QUIT\r\n'
  ];
  this.emit('stdout', 'Command: ' + command + '\n\r');

  chrome.runtime.sendNativeMessage('com.add0n.node', {
    cmd: 'net',
    commands,
    host: this.info['control-host'],
    port: this.info['control-port'],
    password: ''
  }, res => {
    callback(res);
    this.emit('stdout', res.replace(/250[ \-\+]/g, '').replace(/\n\r?/g, '↵'));
  });
};

Tor.prototype.disconnect = function () {
  this.channel.disconnect();
  this.emit('status', 'disconnected');
  this.emit('stdout', 'Kill Tor instance\n\r');
};
var aaa;
Tor.prototype.getIP = function (callback = function () {}) {
  this.command('GETINFO circuit-status', res => {
    aaa = res;
    let id = (res || '')
      .split('\n')
      .filter(s => /^\d+\sBUILT/.test(s)).map(s => /\$([^\s\$\~]+)[\s\~][^\$]*$/.exec(s))
      .filter(a => a)
      .map(a => a[1]).shift();
    if (id) {
      this.command('GETINFO ns/id/' + id, res => {
        let ip = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.exec(res || '');
        if (ip) {
          callback(ip[0]);
          this.info.ip = ip[0];
          this.emit('ip', ip[0]);
        }
        else {
          callback();
        }
      });
    }
    else {
      callback();
    }
  });
};