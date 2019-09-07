var Discord = require('discord.js');
var AWS = require('aws-sdk');
var overwatch = require('overwatch-api');
var schedule = require('node-schedule');
var {promisify} = require('es6-promisify');

var bot = new Discord.Client();

AWS.config.update({
    region: 'eu-west-1'
});

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
                                console.log(putParams);

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

// TODO: Split into functions to unwrap brain

schedule.scheduleJob({hour: 9, minute: 30}, () => {
    console.log("*** Begin Daily Update ***");

    var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    var params = {
        TableName: 'MojitoUsers'
    };
    
    db.scan(params).promise()
    .then(results => results.Items)
    .then(users => {
      Promise.all(
        users.map(user => {
          return getProfile('pc','eu', user.Battletag.S.replace('#', '-'))
          .then(player => {
            user.stats = {
                tank: {
                    rank: player.competitive.tank.rank,
                    gain: player.competitive.tank.rank - user.TankSR.N
                },
                damage: {
                    rank: player.competitive.damage.rank,
                    gain: player.competitive.damage.rank - user.DamageSR.N
                },
                support: {
                    rank: player.competitive.support.rank,
                    gain: player.competitive.support.rank - user.SupportSR.N
                },
                total: player.competitive.support.rank + player.competitive.damage.rank + player.competitive.tank.rank
            };
            user.displayName = user.Battletag.S.split('#')[0];
            user.gains = {
                best: {
                    gain: Math.max(user.stats.tank.gain, user.stats.damage.gain, user.stats.support.gain)
                },
                worst: {
                    gain: Math.min(user.stats.tank.gain, user.stats.damage.gain, user.stats.support.gain)
                }
            };
            user.gains.best.role = getGainRole(user.stats, user.gains.best.gain);
            user.gains.worst.role = getGainRole(user.stats, user.gains.worst.gain);
            return user;
          })
        }))
        .then(players => {

            const leaderList = [...players].sort((a,b) => a.stats.total - b.stats.total );
            let leaders = "";
            for (let i = 0; i < leaderList.length; i++) {
                const p = leaderList[i];
                leaders = leaders + `${i+1}. **${p.displayName}** (🛡${p.stats.tank.rank}/⚔${p.stats.damage.rank}/❤${p.stats.support.rank})`;
            }

            if (leaders == "")
                leaders = "Oops! Looks like noone has been added yet. Use '!mojito add <battletag>' to get started.";

            const tankList = [...players].sort((a,b) => a.stats.tank.rank - b.stats.tank.rank );
            let tanks = "";
            for (let i = 0; i < tankList.length; i++) {
                const p = tankList[i];
                const sr = p.stats.tank.rank > 0 ? p.stats.tank.rank.toString() : "*unplaced*";
                tanks = tanks + `${i+1}. **${p.displayName}** (${sr})`;
            }

            const dpsList = [...players].sort((a,b) => a.stats.damage.rank - b.stats.damage.rank );
            let dps = "";
            for (let i = 0; i < dpsList.length; i++) {
                const p = dpsList[i];
                const sr = p.stats.damage.rank > 0 ? p.stats.damage.rank.toString() : "*unplaced*";
                dps = dps + `${i+1}. **${p.displayName}** (${sr})`;
            }

            const supportList = [...players].sort((a,b) => a.stats.support.rank - b.stats.support.rank );
            let supports = "";
            for (let i = 0; i < supportList.length; i++) {
                const p = supportList[i];
                const sr = p.stats.support.rank > 0 ? p.stats.support.rank.toString() : "*unplaced*";
                supports = supports + `${i+1}. **${p.displayName}** (${sr})`;
            }

            const winnersList = [...players].sort((a,b) => a.gains.best.gain - b.gains.best.gain);
            let winners = "";
            for (let i = 0; i < winnersList.length; i++) {
                const p = winnersList[i];
                if (p.gains.best.gain > 0)
                    winners = winners + `${i+1}. **${p.displayName}** *(${getSigned(p.gains.best.gain)} ${p.gains.best.role})*`;
            }

            const losersList = [...players].sort((a,b) => a.gains.worst.gain - b.gains.worst.gain);
            let losers = "";
            for (let i = 0; i < losersList.length; i++) {
                const p = losersList[i];
                if (p.gains.worst.gain < 0)
                    losers = losers + `${i+1}. **${p.displayName}** *(${getSigned(p.gains.worst.gain)} ${p.gains.worst.role})*`;
            }
    
            bot.guilds.forEach(guild => {
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
                        ":tank": player.stats.tank.rank,
                        ":dps": player.stats.damage.rank,
                        ":support": player.stats.support.rank
                    },
                    ReturnValues: "UPDATED_NEW"
                };

                docClient.update(newParams, (err, data) => {
                    if (err) {
                        console.error(`Unable to update ${player.Battletag.S}: ${JSON.stringify(err, null, 2)}`);
                    }
                });
            });

        });
      });
    
}); // end schedule

bot.login(process.env.MOJ_TOKEN);
