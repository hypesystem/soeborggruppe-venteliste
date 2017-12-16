const oauth2 = require("client-oauth2");
const creds = require("./creds.json").web;
const sheetsAuth = new oauth2({
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    accessTokenUri: creds.token_uri,
    authorizationUri: creds.auth_uri,
    redirectUri: 'http://soeborggruppe.dk/ventelisted-authed',
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const signedRequest = require("./signed-request");

module.exports = {
    userFromUrl,
    requesterFromUrl
};

function userFromUrl(url, callback) {
    sheetsAuth.code.getToken(url)
            .then((user) => callback(null, user))
            .catch((e) => callback(e));
}

function requesterFromUrl(url, callback) {
    userFromUrl(url, (error, user) => {
        if(error) {
            return callback(error);
        }
        callback(null, signedRequest(user));
    });
}
