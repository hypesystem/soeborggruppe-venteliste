'use strict';

const startInvitations = require("./start-invitations");

exports.http = (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "X-Requested-With,Content-Type");
  if(response.method == "OPTIONS") return response.send();

  let { redirectUrl, year, ageGroup, inviteCount, leaderEmail } = request.body;
  startInvitations(redirectUrl, year, ageGroup, inviteCount, leaderEmail, (error) => {
    if(error) {
      return response.status(500).send("Error! " + error.message + " - " + JSON.stringify(error));
    }
    response.status(200).send("I dun did it bruv");
  });
};


exports.event = (event, callback) => {
  callback();
};
