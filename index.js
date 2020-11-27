const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const fs = require('fs');
const path = require('path');
const { exec } = require("child_process");
const ws = require('ws');

var jsonParser = bodyParser.json();

var statemachine = 0;

const wsServer = new ws.Server({ noServer: true });
wsServer.on('connection', socket => {
  socket.on('message', message => console.log(message));
});

function execLogstash() {
  statemachine = 2;
  exec("truncate -s 0 /root/logslash/output/output.log", (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      statemachine = 3;
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      statemachine = 4;
      return;
    }
    console.log(`stdout: ${stdout}`);
    statemachine = 5;
  });


  exec("docker exec logstash kill -SIGHUP 1", (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      statemachine = 6;
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      statemachine = 7;
      return;
    }
    console.log(`stdout: ${stdout}`);
    statemachine = 8;
  });
}

function checkOutput() {
  try {
    const fileHandle = fs.open(outputfile, fs.constants.O_RDONLY | 0x10000000, function (err) {
      if (err) console.log(err); return;
    });
    //fileHandle.close();
    statemachine = 10;
  } catch (error) {
    if (error.code === 'EBUSY') {
      console.log('file is busy');
      statemachine = 9;
    } else {
      throw error;
    }
  }
}

var pipelinepath = path.join(__dirname, 'pipeline', 'logstash.conf');
var samplelog = path.join(__dirname, 'logs', 'logsample.log');
var outputfile = path.join(__dirname, 'output', 'output.log');

app.use('/', express.static('frontend'));

app.post('/tasks', jsonParser, function (req, res) {
  statemachine = 1;
  var pipelinehead = "input { file { path => \"/tmp/logsample.log\" sincedb_path => \"/dev/null\" mode => \"read\" start_position => \"beginning\" } } \n";
  var pipelinefoot = "output { file { path => \"/tmp/output.log\" } }";
  console.log(req.body);
  fs.writeFile(samplelog, req.body.logsample, function (err) {
    if (err) return console.log(err);
    console.log('Log Sample written logsample.log');
  });
  fs.writeFile(pipelinepath, pipelinehead.concat(req.body.pipeline, pipelinefoot), function (err) {
    if (err) return console.log(err);
    console.log('Pipeline written logstash.conf');
  });
  execLogstash();
  res.send('Task started successfully');
});

app.get('/results', function (req, res) {
  checkOutput();
  if (statemachine === 10) {
    res.sendFile(outputfile);
  }
  else {
    res.status(202).json({ status: "Processing data..", state: statemachine });
  }
});

const server = app.listen(port, () => {
  console.log(`Logslash listening at http://localhost:${port}`);
});

server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, socket => {
    wsServer.emit('connection', socket, request);
  });
});
