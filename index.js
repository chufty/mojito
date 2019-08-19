var Discord = require('discord.io');
var AWS = require('aws-sdk');

var bot = new Discord.Client({
    autorun: true,
    token: process.env.MOJ_TOKEN
});

AWS.config.update({
    region: 'eu-west-1'
});

bot.on('ready', function(event) {
    console.log('Logged in as %s - %s\n', bot.username, bot.id);
});

bot.on('message', function(user, userID, channelID, message, event) {
    if (message.substring(0, 8) === '!mojito ')
    {
        var args = message.split(' ');
        var cmd = args[1];

        switch(cmd) {
            case 'add':
                var user = args[2];
                // Add a Battletag to the user list
                var db = new AWS.DynamoDB.DocumentClient();
                var params = {
                    TableName: 'MojitoUsers',
                    Key: user
                };
                
                db.get(params, (err, data) => {
                    if (err) 
                })
        }
    }
});