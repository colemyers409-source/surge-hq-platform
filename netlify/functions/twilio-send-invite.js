const twilio = require('twilio');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
      try {
          const { recruitName, recruitPhone, inviteCode, agentName } = JSON.parse(event.body);
              const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                  const message = await client.messages.create({
                        to: recruitPhone,
                              from: process.env.TWILIO_PHONE_NUMBER,
                                    body: `Hi ${recruitName}! ${agentName} has invited you to join Surge Life Group. Use code ${inviteCode} to create your account at hq.surgelifegroup.com`,
                                        });
                                            return { statusCode: 200, headers, body: JSON.stringify({ sid: message.sid }) };
                                              } catch (err) {
                                                  return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
                                                    }
                                                    };
