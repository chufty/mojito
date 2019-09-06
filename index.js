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
                                console.log(err);
                                message.channel.send(`Sorry, couldn't find user with battletag ${user}`);
                            } 
                            else {
                                var damageSR = json.competitive.damage.rank;
                                var supportSR = json.competitive.support.rank;
                                var tankSR = json.competitive.tank.rank;

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
                                        console.log(err);
                                    });
                            }
                        });
                    }
                })
                .catch(e => {
                    // TODO: Handle error
                    console.log(e);
                    message.channel.send("Oops, something when catastrophically wrong. It's probably Chufty's fault...");
                });
        }
    }
});

const getProfile = promisify(overwatch.getProfile);

// TODO: Split into functions to unwrap brain
let buildPlayer = new Promise((resolve, reject) => {

});


schedule.scheduleJob('*/1 * * * *', () => {
    console.log("*** Daily Update V2 ***");

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
            return user;
          })
        }))
        .then(players => {
            console.log(`Got stats for ${players.length} players, looks like this:`);
            console.log(players);

            const leaderList = [...players].sort((a,b) => a.stats.total - b.stats.total );
            let leaders = "";
            for (let i = 0; i < leaderList.length; i++) {
                const p = leaderList[i];
                leaders = leaders + `${i+1}. **${p.Battletag.S.split('#')[0]}** (🛡${p.stats.tank.rank}/⚔${p.stats.damage.rank}/❤${p.stats.support.rank})`
            }
        
            console.log(`Leaderboard contains ${leaderList.length} players`);
    
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
                                value: leaders
                            }
                        ]
                    };
        
                    console.log(`Posting message: ${message}`);
        
                    guild.channels.find(c => c.name === 'general')
                        .send('Good morning (former) Cocktail Riot! Here is your daily SR update...', {embed: message});
                }
            });

            // TODO: Update database with new stats argh
        });
      });
    
}); // end schedule

// var job = schedule.scheduleJob('*/1 * * * *', () => {
//     console.log('*** Performing Daily Update ***');
    
//     console.log('Getting all users...');
//     var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
//     var params = {
//         TableName: 'MojitoUsers'
//       };
    
//     Promise.all(
//     db.scan(params).promise()
//     .then(data => {
//         let players = new Array();
//         data.Items.map(user => {
//             console.log(`Found user ${user.Battletag.S}`);

//             getProfile('pc','eu', user.Battletag.S.replace('#', '-'))
//             .then(data => {
//                 console.log(`Got the profile`);
//                 let player = {
//                     battletag: user.Battletag.S,
//                     name: user.Battletag.S.split('#')[0],
//                     tank: {
//                         rank: data.competitive.tank.rank,
//                         gain: data.competitive.tank.rank - user.TankSR.N
//                     },
//                     damage: {
//                         rank: data.competitive.damage.rank,
//                         gain: data.competitive.damage.rank - user.DamageSR.N
//                     },
//                     support: {
//                         rank: data.competitive.support.rank,
//                         gain: data.competitive.support.rank - user.SupportSR.N
//                     },
//                     total: data.competitive.support.rank + data.competitive.damage.rank + data.competitive.tank.rank
//                 };
//                 players.push(player)
//             })
//             .catch(err => {
//                 console.error(`Error loading profile for ${user.Battletag.S}`);
//                 console.error(err);
//             });
//         });
//         return players;
//     })
//     .then(players => {

//         console.log(`Done with database: found ${players.length} players`);
    
//         const leaderList = [...players].sort((a,b) => a.total - b.total );
//         let leaders = "";
//         for (let i = 0; i < leaderList.length; i++) {
//             const p = leaderList[i];
//             leaders = leaders + `${i+1}. **${p.name}** (${p.tank.rank}/${p.damage.rank}/${p.support.rank})`
//         }
    
//         console.log(`Leaderboard contains ${leaderList.length} players`);

//         bot.guilds.forEach(guild => {
//             if (guild.available) {
//                 console.log('Attempting to post update to server ' + guild.name);
    
//                 let message = {
//                     embed: {
//                         color: 5036231,
//                         author: "Cocktail Riot"
//                     },
//                     fields: [
//                         {
//                             name: "Leaderboard",
//                             value: leaders
//                         }
//                     ]
//                 };
    
//                 console.log(`Leaderboard: ${leaders}`);
    
//                 guild.channels.find(c => c.name === 'general')
//                     .send('Good morning (former) Cocktail Riot! Here is your daily SR update...', message);
//             }
//         });
//     }))
//     .then(data => console.log(data))
//     .catch(err => console.error(`Error reading DynamoDB database: ${err}`));

//         // let message = ("Good morning Cocktail Riot! Here's your daily SR update", {
//         //     "embed": {
//         //       "color": 5036231,
//         //       "author": {
//         //         "name": "Cocktail Riot",
//         //         "icon_url": "https://cdn.discordapp.com/icons/420155827689619456/41e74064327e13e1c85421bbde50f065.webp"
//         //       },
//         //       "fields": [
//         //         {
//         //           "name": "Overall Leaderboard",
//         //           "value": "1. **Chufty** ()\n2. **Seabo** ()"
//         //         },
//         //         {
//         //           "name": "🛡 Tank",
//         //           "value": "1. **Chufty**",
//         //           "inline": true
//         //         },
//         //         {
//         //           "name": "⚔ DPS",
//         //           "value": "1. **Chufty**",
//         //           "inline": true
//         //         },
//         //         {
//         //           "name": "❤ Support",
//         //           "value": "1. **Chufty**",
//         //           "inline": true
//         //         },
//         //         {
//         //           "name": "Biggest Winners",
//         //           "value": "1. Chufty *(Tank, +32)*"
//         //         },
//         //         {
//         //           "name": "Biggest Losers",
//         //           "value": "1. Seabo *(Support, -422)*"
//         //         }
//         //       ]
//         //     }
//         //   });
//     });

bot.login(process.env.MOJ_TOKEN);