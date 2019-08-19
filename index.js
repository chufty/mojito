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
                var db = new AWS.DynamoDB({apiVersion: '2012-08-10'});
                var params = {
                    TableName: 'MojitoUsers',
                    Key: {
                      'Battletag': {S: user}
                    }
                  };
                
                try {
                    let data = await db.getItem(params).promise();
                    if (data.Item !== undefined)
                    {
                        // User already added; message channel to indicate as such
                    }
                } catch (e) {
                    // TODO: Handle error
                }
        }
    }
});