const sheetsAuth = require("./sheets-auth");
const uuid = require("uuid");
const MailgunMustacheMailer = require("mailgun-mustache-mailer");
const mailgunConfig = require("./mailgun-config.json");
const fs = require("fs");
const path = require("path");
const spacetime = require("spacetime/immutable");

const emailHtmlTemplate = fs.readFileSync(path.join(__dirname, "email.html"), "utf8");
const emailTextTemplate = fs.readFileSync(path.join(__dirname, "email.text"), "utf8");

const waitListSheetId = "1lzEFVa3RdZEBlgBrWo3ShKeaxxKfVHHrbMdPeZg5yz8";
const dbSheetId = "131NYqurxmRS2mVbsWG4wp8RXBZse5XGgyu3Cf3biM8A";

const mailer = new MailgunMustacheMailer(mailgunConfig, {
    info: console.log,
    error: console.error
});

//get uri to auth!:
//console.log("pls auth at", sheetsAuth.code.getUri());

//FLOW SHOULD BE
// - Find who to invite (done)
// - Send off emails
// - Save state of this operation (done)

let year = 2004;
let ageGroup = "trop";
let inviteCount = 1;
let redirectUrl = "http://soeborggruppe.dk/ventelisted-authed?code=4/LUXqkeluYPOiIbvJiK3bSaxPy5bYVXSazxN4Tj9PpOU#";
let leaderEmail = "niels.abildgaard+leader@gmail.com";

module.exports = (redirectUrl, year, ageGroup, inviteCount, leaderEmail, callback) => {
    sheetsAuth.requesterFromUrl(redirectUrl, (error, request) => {
        if(error) {
            return callback(error);
        }

        findWaitersToInvite(request, year, inviteCount, (error, waitersToInvite) => {
            if(error) {
                console.error("Failed to find waiters to invite", error);
                return callback(error);
            }

            console.log("Found waiters to invite", waitersToInvite);

            let operationId = uuid.v4();

            sendEmailsToWaiters(waitersToInvite, ageGroup, operationId, (error) => {
                if(error) {
                    console.error("Failed to send emails to waiters", error);
                    return callback(error);
                }

                console.log("Sent emails to waiters");

                saveOperationState(request, year, ageGroup, inviteCount, waitersToInvite, leaderEmail, operationId, (error) => {
                    if(error) {
                        console.error("Failed to save operation state", error);
                        return callback(error);
                    }

                    console.log("Saved operation state. Done!");

                    callback();
                });
            });
        });
    });
};

function findWaitersToInvite(request, year, inviteCount, callback) {
    getAllWaiters(request, (error, waiters) => {
        if(error) {
            console.error("Failed to get all waiters, so bubbling:", error);
            return callback(error);
        }

        let currentDate = new Date();
        let currentMonthDate = `${currentDate.toISOString().substring(0, 7)}`;

        let data = waiters
                    .filter(waiter => waiter.birthYear == year)
                    .filter(waiter => waiter.earliestStart <= currentMonthDate)
                    .sort((a,b) => {
                        if(a.hasSiblingsInGroup && !b.hasSiblingsInGroup) return -1;
                        if(b.hasSiblingsInGroup && !a.hasSiblingsInGroup) return 1;
                        if(a.created < b.created) return -1;
                        return 1;
                    })
                    .slice(0, inviteCount);

        callback(null, data);
    });
}

function getAllWaiters(request, callback) {
    readValuesFromSheet(request, waitListSheetId, "R%C3%A5data!A2:L999", (error, httpResponse, body) => {
        if(error) {
            return callback(error);
        }
        if(httpResponse.statusCode != 200) {
            return callback(new Error("Http " + httpResponse.statusCode + ": " + JSON.stringify(body)));
        }
        callback(null, formatData(body));
    });
}

function readValuesFromSheet(request, sheetId, query, callback) {
    request({
        method: "get",
        url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${query}`,
        json: true
    }, callback);
}

function formatData(data) {
    return data.values.map(row => {
        let created = parseDateString(row[0]);
        let hasSiblingsInGroup = parseTextBoolean(row[8]);
        let earliestStart = parseEarliestStart(row[11]);
        let birthYear = row[5];
        let birthMonth = padZeroesToLength(2, row[4]);
        let birthDate = padZeroesToLength(2, row[3]);
        let wantsToBeScoutLeader = parseTextBoolean(row[10]);
        let email = row[7];
        let parentFullName = row[9];

        return {
            operationUniqueId: uuid.v4(),
            created,
            birthYear,
            hasSiblingsInGroup,
            earliestStart,
            email, //`${parentFullName} <${email}>`,
            child: {
                firstName: row[1],
                lastName: row[2],
                fullName: `${row[1]} ${row[2]}`,
                birthdate: `${birthYear}-${birthMonth}-${birthDate}`,
                hasSiblingsInGroup,
                earliestStart
            },
            parent: {
                phoneNumber: row[6],
                email,
                fullName: parentFullName,
                wantsToBeScoutLeader
            }
        };
    });
}

function parseDateString(str) {
    if(!str) {
        return "9999-99-99 99:99:99";
    }
    let r = str.match(/(\d{2})\/(\d{2})\/(\d{4}) (.+)/);
    return `${r[3]}-${r[2]}-${r[1]}T${r[4]}Z`;
}

function padZeroesToLength(length, str) {
    if(str.length < length) {
        return padZeroesToLength(length, "0" + str);
    }
    return str;
}

function parseTextBoolean(str) {
    return str == "Ja";
}

function parseEarliestStart(str) {
    if(str == "Hurtigst muligt") {
        return "0000-00";
    }
    let parts = str.split(" ");
    let month = parseDanishTextMonth(parts[0]);
    let year = parts[1];
    return `${year}-${padZeroesToLength(2, month)}`;
}

function parseDanishTextMonth(str) {
    return "" + ([ "Januar", "Februar", "Marts", "April", "Maj", "Juni", "Juli", "August", "September", "Oktober", "November", "December" ].indexOf(str) + 1);
}

function sendEmailsToWaiters(waitersToInvite, ageGroup, operationId, callback) {
    let viewModels = makeViewModel(ageGroup, operationId, waitersToInvite);
    mailer.sendBatch({
        subject: `Nu er der plads til {{ child.firstName }} i 1. Søborg Gruppe!`,
        text: emailTextTemplate,
        html: emailHtmlTemplate
    }, viewModels, callback);
}

function makeViewModel(ageGroup, operationId, waitersToInvite) {
    let branch = getBranch(ageGroup);
    let trialMeetings = getTrialMeetings(ageGroup);
    return waitersToInvite.map(viewModel => {
        viewModel = Object.assign({}, viewModel);
        viewModel.branch = branch;
        viewModel.operationId = operationId;
        viewModel.trialMeetings = trialMeetings;
        return viewModel;
    });
}

function getBranch(ageGroup) {
    return {
        "familie": {
            name: "familieflokken",
            leadersName: "Familieflokslederne",
            meetings: {
                weekDay: "søndag (lige uger)",
                startTime: "10:00",
                endTime: "12:00"
            }
        },
        "mikro": {
            name: "mikroflokken",
            leadersName: "Mikrolederne",
            meetings: {
                weekDay: "torsdag",
                startTime: "17:00",
                endTime: "18:30"
            }
        },
        "mini": {
            name: "miniflokken",
            leadersName: "Minilederne",
            meetings: {
                weekDay: "torsdag",
                startTime: "18:30",
                endTime: "20:00"
            }
        },
        "junior": {
            name: "juniorflokken",
            leadersName: "Juniorlederne",
            meetings: {
                weekDay: "tirsdag",
                startTime: "19:00",
                endTime: "21:00"
            }
        },
        "trop": {
            name: "troppen",
            leadersName: "Tropslederne",
            meetings: {
                weekDay: "tirsdag",
                startTime: "19:00",
                endTime: "21:00"
            }
        }
    }[ageGroup];
}

function getTrialMeetings(ageGroup) {
    let today = spacetime();
    let inThreeWeeks = today.add(3, "weeks");
    let firstDay;
    let weekInterval = 1;
    let dayName;
    if(ageGroup == "mikro" || ageGroup == "mini") {
        firstDay = inThreeWeeks.day("thursday");
        dayName = "Torsdag";
    }
    else if(ageGroup == "junior" || ageGroup == "trop") {
        firstDay = inThreeWeeks.day("tuesday");
        dayName = "Tirsdag";
    }
    else {
        firstDay = inThreeWeeks.day("sunday");
        if(firstDay.week() % 2 != 0) {
            firstDay = firstDay.add(1, "day");
        }
        weekInterval = 2;
        dayName = "Søndag";
    }

    let firstDay = pushUntilInSeason(firstDay, weekInterval);
    let secondDay = pushUntilInSeason(firstDay.add(weekInterval, "week"));
    let thirdDay = pushUntilInSeason(secondDay.add(weekInterval, "week"));

    return [ firstDay, secondDay, thirdDay ].map((day) => prettyDate(day, dayName));
}

function pushUntilInSeason(day, weekInterval) {
    while(isOffSeason(day)) {
        day = day.add(weekInterval, "week");
    }
    return day;
}

function isOffSeason(day) {
    //TODO: Is summer
    //TODO: Is week 42
    //TODO: Is christmas/newyear
    //TODO: Is winter holiday
    //TODO: Is easter
    //TODO: Is Store bededag
    //TODO: Is Kristi himmelfartsdag
    //TODO: Is pinsen
    return false;
}

function prettyDate(date, dayName) {
    return { date: `${dayName} d. ${date.date()}/${date.month() + 1}` };
}

function saveOperationState(request, year, ageGroup, inviteCount, waitersToInvite, leaderEmail, operationId, callback) {
    let blob = {
        year,
        ageGroup,
        inviteCount,
        leaderEmail,
        surplusInvites: inviteCount - waitersToInvite.length,
        awaitingInvites: waitersToInvite.map((waiter) => { return {
            operationUniqueId: waiter.operationUniqueId,
            created: waiter.created,
            childFirstName: waiter.child.firstName,
            childLastName: waiter.child.lastName
        }; })
    };

    insertAtEndOfSheet(request, dbSheetId, "db", [ (new Date()).toISOString(), operationId, JSON.stringify(blob) ], callback);
}

function insertAtEndOfSheet(request, sheetId, sheetName, row, callback) {
    readValuesFromSheet(request, sheetId, `${sheetName}!A1:A999`, (error, httpResponse, body) => {
        if(error) {
            return callback(error);
        }
        if(httpResponse.statusCode != 200) {
            return callback(new Error("Http " + httpResponse.statusCode + ": " + JSON.stringify(body)));
        }

        let rowCount = body.values.length;

        insertRowInSheet(request, sheetId, sheetName, rowCount + 1, row, callback);
    });
}

function insertRowInSheet(request, sheetId, sheetName, rowPos, row, callback) {
    request({
        method: "post",
        url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/db!A1:${letterFor(row.length)}${rowPos - 1}:append?valueInputOption=RAW`,
        body: {
            range: `db!A1:${letterFor(row.length)}${rowPos - 1}`,
            majorDimension: "ROWS",
            values: [ row ]
        },
        json: true
    }, (error, httpResponse, body) => {
        if(error) {
            return callback(error);
        }
        if(httpResponse.statusCode != 200) {
            return callback(new Error("Http " + httpResponse.statusCode + ": " + JSON.stringify(body)));
        }
        callback();
    });
}

function letterFor(i) {
    return String.fromCharCode(64 + i);
}
