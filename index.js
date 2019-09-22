var Discord = require('discord.js');
var AWS = require('aws-sdk');
var overwatch = require('overwatch-api');
var schedule = require('node-schedule');
var {promisify} = require('es6-promisify');

var bot = new Discord.Client();

AWS.config.update({
    region: 'eu-west-1'
});

// Commands
function Help(user) {
    user.sendMessage(`Channel commands:
    \`!mojito help\`: List my commands (it\'s what I\'m doing now...).
    \`!mojito add <battletag>\`: Adds the specified Battle.net user to the Daily Update.`);
}

function Add(guild, user, battletag, force, channel) {
    var docClient = new AWS.DynamoDB.DocumentClient();
    var existsQuery = {
        TableName: 'MojitoGuilds',
        Key: {
            'GuildId': guild,
            'Username':user
        }
    };

    docClient.get(existsQuery).promise()
    .then(data => {
    })
    .catch(err => {
        console.error(err);
        channel.sendMessage('Oops, something went wrong. Blame Chufty.');
    })
}

bot.on('ready', function(event) {
    console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
});

bot.on('message', message => {
    if (message.content.substring(0, 8) === '!mojito ')
    {
        var args = message.content.split(' ');
        var cmd = args[1];

        switch(cmd) {
            case 'add':
                var user = args[2];
                // Add a Battletag to the user list
                var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
                var params = {
                    TableName: 'MojitoUsers',
                    Key: {
                      'Battletag': {S: user}
                    }
                  };
                
                db.getItem(params).promise()
                .then((data) => {
                    if (data.Item !== undefined)
                    {
                        // User already added; message channel to indicate as such
                        message.channel.send(`Looks like battletag ${user} has already been added`);
                    }
                    else
                    {
                        // Fetch info about this user from the Overwatch API
                        overwatch.getProfile('pc', 'eu', user.replace('#', '-'), (err, json) => {
                            if (err)
                            {
                                console.error(err);
                                message.channel.send(`Sorry, couldn't find user with battletag ${user}`);
                            } 
                            else {
                                var damageSR = json.competitive.damage.rank || 0;
                                var supportSR = json.competitive.support.rank || 0;
                                var tankSR = json.competitive.tank.rank || 0;

                                var putParams = {
                                    TableName: 'MojitoUsers',
                                    Item: {
                                        'Battletag': {S: user},
                                        'DamageSR': {N: damageSR.toString()},
                                        'SupportSR': {N: supportSR.toString()},
                                        'TankSR': {N: tankSR.toString()}
                                    }
                                };

                                console.log(`Attempting to add user ${user} to the database`);

                                db.putItem(putParams).promise()
                                    .then((result) => {
                                        message.channel.send(
                                            `Success! Added ${user} (Tank ${tankSR}/Support ${supportSR}/DPS ${damageSR}) to the Daily Update`);
                                    })
                                    .catch((err) => {
                                        message.channel.send(`Found user ${user} but failed to add them to the Daily Update for some reason.`);
                                        console.error(err);
                                    });
                            }
                        });
                    }
                })
                .catch(e => {
                    // TODO: Handle error
                    console.error(e);
                    message.channel.send("Oops, something when catastrophically wrong. It's probably Chufty's fault...");
                });
                break;
            case 'update':
                // TODO: Introduce admin role
                if (message.member.hasPermission('MANAGE_GUILD')) {
                    adhocUpdate([message.guild]);
                }
                else {
                    message.channel.send('Only special people may invoke this command');
                }
                break;
            case 'help':
            case 'commands':
            case 'h':
            case '?':
                Help(message.author);
                break;
        }
    }
});

const getSigned = function(number) {
    return number > 0
        ? `+${number.toString()}`
        : number.toString();
}

// TODO: This method is crude, refactor?
const getGainRole = function(stats, gain) {
    if (stats.tank.gain == gain)
        return "🛡";
    if (stats.damage.gain == gain)
        return "⚔";
    if (stats.support.gain == gain)
        return "❤";
    return "";
}

const getProfile = promisify(overwatch.getProfile);

function getUpdate(users) {
    return Promise.all(
        users.map(async user => {
          const player = await getProfile('pc', 'eu', user.Battletag.S.replace('#', '-'));
            user.stats = {
                tank: {
                    rank: player.competitive.tank.rank,
                    gain: player.competitive.tank.rank - (user.TankSR.N || player.competitive.tank.rank)
                },
                damage: {
                    rank: player.competitive.damage.rank,
                    gain: player.competitive.damage.rank - (user.DamageSR.N || player.competitive.damage.rank)
                },
                support: {
                    rank: player.competitive.support.rank,
                    gain: player.competitive.support.rank - (user.SupportSR.N || player.competitive.support.rank)
                },
                best: Math.max(player.competitive.support.rank || 0, player.competitive.damage.rank || 0, player.competitive.tank.rank || 0)
            };
            user.displayName = user.Battletag.S.split('#')[0];
            user.gains = {
                best: {
                    gain: Math.max(user.stats.tank.gain || 0, user.stats.damage.gain || 0, user.stats.support.gain || 0)
                },
                worst: {
                    gain: Math.min(user.stats.tank.gain || 0, user.stats.damage.gain || 0, user.stats.support.gain || 0)
                }
            };
            user.gains.best.role = getGainRole(user.stats, user.gains.best.gain);
            user.gains.worst.role = getGainRole(user.stats, user.gains.worst.gain);
            return user;
        }));
}

function postUpdate(players, guilds) {
    const leaderList = [...players].filter(player => player.stats.best > 0).sort((a,b) => b.stats.best - a.stats.best );
    let leaders = "";
    for (let i = 0; i < leaderList.length; i++) {
        const p = leaderList[i];
        leaders = leaders + `${i+1}. **${p.displayName}** (🛡${p.stats.tank.rank || "*[unplaced]*"}/⚔${p.stats.damage.rank || "*[unplaced]*"}/❤${p.stats.support.rank || "*[unplaced]*"})\n`;
    }

    if (leaders == "")
        leaders = "Oops! Looks like noone has been added yet. Use '!mojito add <battletag>' to get started.";

    const tankList = [...players].filter(player => player.stats.tank.rank > 0).sort((a,b) => b.stats.tank.rank - a.stats.tank.rank );
    let tanks = "";
    for (let i = 0; i < tankList.length; i++) {
        const p = tankList[i];
        tanks = tanks + `${i+1}. **${p.displayName}** (${p.stats.tank.rank || "*unplaced*"})\n`;
    }

    const dpsList = [...players].filter(player => player.stats.damage.rank > 0).sort((a,b) => b.stats.damage.rank - a.stats.damage.rank );
    let dps = "";
    for (let i = 0; i < dpsList.length; i++) {
        const p = dpsList[i];
        dps = dps + `${i+1}. **${p.displayName}** (${p.stats.damage.rank || "*unplaced*"})\n`;
    }

    const supportList = [...players].filter(player => player.stats.support.rank > 0).sort((a,b) => b.stats.support.rank - a.stats.support.rank );
    let supports = "";
    for (let i = 0; i < supportList.length; i++) {
        const p = supportList[i];
        supports = supports + `${i+1}. **${p.displayName}** (${p.stats.support.rank || "*unplaced*"})\n`;
    }

    const winnersList = [...players].filter(p => p.gains.best.gain > 0).sort((a,b) => b.gains.best.gain - a.gains.best.gain);
    let winners = "";
    for (let i = 0; i < winnersList.length; i++) {
        const p = winnersList[i];
        winners = winners + `${i+1}. **${p.displayName}** *(${getSigned(p.gains.best.gain)} ${p.gains.best.role})*\n`;
    }

    const losersList = [...players].filter(p => p.gains.worst.gain < 0).sort((a,b) => a.gains.worst.gain - b.gains.worst.gain);
    let losers = "";
    for (let i = 0; i < losersList.length; i++) {
        const p = losersList[i];
        losers = losers + `${i+1}. **${p.displayName}** *(${getSigned(p.gains.worst.gain)} ${p.gains.worst.role})*\n`;
    }

    guilds.forEach(guild => {
        if (guild.available) {
            console.log('Attempting to post update to server ' + guild.name);

            let message = {
                color: 5036231,
                author: {
                    name: "Cocktail Riot",
                    icon_url: "https://cdn.discordapp.com/icons/420155827689619456/41e74064327e13e1c85421bbde50f065.webp"
                },
                fields: [
                    {
                        name: "Leaderboard",
                        value: leaders || '\u200B'
                    },
                    {
                        name: '\u200B',
                        value: '\u200B',
                    },
                    {
                        name: "🛡 Tank",
                        value: tanks || '\u200B',
                        inline: true
                    },
                    {
                        name: "⚔ DPS",
                        value: dps || '\u200B',
                        inline: true
                    },
                    {
                        name: "❤ Support",
                        value: supports || '\u200B',
                        inline: true
                    },
                    {
                        name: '\u200B',
                        value: '\u200B',
                    },
                    {
                        name: "Biggest Winners",
                        value: winners || '*No gains today :disappointed:*'
                    },
                    {
                        name: "Biggest Losers",
                        value: losers || '*No losses today :joy:*'
                    }
                ]
            };

            guild.channels.find(c => c.name === 'general')
                .send('Good morning (former) Cocktail Riot! Here is your daily SR update...', {embed: message});
        }
    });
}

function updateDb(players) {
    // Update database with new stats argh
    console.log('Updating DB');
    var docClient = new AWS.DynamoDB.DocumentClient();
    players.forEach(player => {

        var newParams = {
            TableName: 'MojitoUsers',
            Key: {
                'Battletag': player.Battletag.S
            },
            UpdateExpression: "set TankSR = :tank, DamageSR = :dps, SupportSR = :support",
            ExpressionAttributeValues: {
                ":tank": player.stats.tank.rank || "0",
                ":dps": player.stats.damage.rank || "0",
                ":support": player.stats.support.rank || "0"
            },
            ReturnValues: "UPDATED_NEW"
        };

        docClient.update(newParams, (err, data) => {
            if (err) {
                console.error(`Unable to update ${player.Battletag.S}: ${JSON.stringify(err, null, 2)}`);
            }
        });
    });
}

function dailyUpdate() {
    var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    var params = {
        TableName: 'MojitoUsers'
    };
    
    db.scan(params).promise()
    .then(results => results.Items)
    .then(users => {
      getUpdate(users)
        .then(players => {
            postUpdate(players, bot.guilds);
            updateDb(players);
        });
      });
}

function adhocUpdate(guilds) {
    var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    var params = {
        TableName: 'MojitoUsers'
    };
    
    db.scan(params).promise()
    .then(results => results.Items)
    .then(users => {
      getUpdate(users)
        .then(players => {
            postUpdate(players, guilds);
        });
      });
}

schedule.scheduleJob({hour: 9, minute: 0}, () => {
    console.log("*** Begin Daily Update ***");
    dailyUpdate();
});

bot.login(process.env.MOJ_TOKEN);
