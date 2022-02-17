import express from 'express';
import session from 'express-session';
import fs from 'fs';
import axios from 'axios';
import { OAuth } from 'oauth';

const config = JSON.parse(fs.readFileSync('./config.oauth1.json', 'utf-8'));
const { consumerKey, jiraUrl, localUrl } = config;

const privateKeyData = fs.readFileSync('./keys/jira_privatekey.pem', 'utf-8');

const consumer = new OAuth(
    `${jiraUrl}/plugins/servlet/oauth/request-token`,
    `${jiraUrl}/plugins/servlet/oauth/access-token`,
    consumerKey,
    privateKeyData,
    '1.0',
    `${localUrl}/oauth/1.0/callback`,
    'RSA-SHA1'
);

const app = express();
app.use(session({ secret: 'supersessionsecret' }));

app.get('/', (req, res) => {
    res.redirect('/oauth/1.0/connect');
});

app.get('/oauth/1.0/connect', (req, res) => {
    consumer.getOAuthRequestToken((err, token, secret, results) => {
        if (err) {
            console.error(err);
            return res.send('Error getting OAuth request token');
        }

        // Save the secret in the session - it will be required in callback
        // If you have any better idea as where to save it, please say!
        (req.session as any).oauthRequestTokenSecret = secret;
        res.redirect(`${jiraUrl}/plugins/servlet/oauth/authorize?oauth_token=${token}`);
    });
});

let oauthToken: string | null = null;
let oauthSecret: string | null = null;
app.get('/oauth/1.0/callback', (req, res) => {
    consumer.getOAuthAccessToken(
        req.query.oauth_token as string,
        (req.session as any).oauthRequestTokenSecret,
        req.query.oauth_verifier as string,
        async (err, token, secret, results) => {
            if (err) {
                console.error(err);
                return res.send('Error getting OAuth access token');
            }

            // Save this somewhere - it will be needed to make requests to Jira
            oauthToken = token;
            oauthSecret = secret;

            res.send('Token saved');
        }
    );
});

app.get('/issue/:issueId', async (req, res) => {
    if (!oauthToken || !oauthSecret) {
        return res.send('OAuth token is not configured!');
    }

    const requestUrl = `${jiraUrl}/rest/api/2/issue/${req.params.issueId}`;
    const method = 'get';
    const authHeader = consumer.authHeader(requestUrl, oauthToken, oauthSecret, method);

    const response = await axios.get(requestUrl, {
        headers: {
            Authorization: authHeader,
        },
    });

    res.send(response.data);
});

export default app;
