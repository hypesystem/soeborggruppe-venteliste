'use strict';

exports.expose = (request, response) => {
  response.status(200).send(test());
};

exports.sendForward = (request, response) => {
  response.status(200).send('hey');
};

exports.event = (event, callback) => {
  callback();
};

function test() {
  return 'wow it works';
};
