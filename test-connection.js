require('dotenv').config();
const { App } = require('@slack/bolt');

console.log('=== Epic Bot Connection Test ===\n');

// Check environment variables
console.log('Environment Variables:');
console.log('SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? '✓ Set (xoxb-...)' : '✗ Missing');
console.log('SLACK_APP_TOKEN:', process.env.SLACK_APP_TOKEN ? '✓ Set (xapp-...)' : '✗ Missing');
console.log('SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? '✓ Set' : '✗ Missing');
console.log();

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Test token formats
const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

console.log('Token Validation:');
console.log('Bot token starts with xoxb-:', botToken.startsWith('xoxb-') ? '✓' : '✗ WRONG FORMAT');
console.log('App token starts with xapp-:', appToken.startsWith('xapp-') ? '✓' : '✗ WRONG FORMAT');
console.log();

// Try to initialize the app
console.log('Initializing Slack App...');
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  socketModeOptions: {
    logLevel: 'debug' // Enable debug logging for this test
  }
});

// Add a simple test command
app.command('/story', async ({ command, ack, client }) => {
  console.log('✓ /story command received!');
  await ack();
  console.log('✓ Command acknowledged');

  await client.chat.postMessage({
    channel: command.channel_id,
    text: '✓ Bot is working! Connection test successful.'
  });

  console.log('✓ Message sent');
  console.log('\n✅ TEST PASSED - Bot is working correctly!');
  process.exit(0);
});

// Start the app
(async () => {
  try {
    console.log('Starting bot...');
    await app.start();
    console.log('✅ Bot connected successfully!');
    console.log('\nWaiting for /story command...');
    console.log('Go to Slack and type: /story test');
    console.log('\n(Press Ctrl+C to exit)\n');
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
})();
