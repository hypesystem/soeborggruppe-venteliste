const request = require("request");

module.exports = (user) => (opts, callback) => request(user.sign(opts), callback);
