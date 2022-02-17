import fs from 'fs';
import express from 'express';
import session from 'express-session';
import axios from 'axios';
import { OAuth2 } from 'oauth';

const config = JSON.parse(fs.readFileSync('./config.oauth2.json', 'utf-8'));
const { clientId, clientSecret, localUrl, jiraUrl } = config;

const app = express();
app.use(session({ secret: 'supersessionsecret' }));

const consumer = new OAuth2(clientId, clientSecret, 'https://auth.atlassian.com', '/authorize', '/oauth/token');

app.get('/', (req, res) => {
    res.redirect('/oauth/2.0/connect');
});

const redirectUrl = `${localUrl}/oauth/2.0/callback`;
const scopes = ['read:jira-work', 'read:jira-user', 'offline_access'];
app.get('/oauth/2.0/connect', (req, res) => {
    const authorizeUrl = consumer.getAuthorizeUrl({
        audience: 'api.atlassian.com',
        scope: scopes.join(' '),
        redirect_uri: redirectUrl,
        state: req.sessionID,
        response_type: 'code',
        prompt: 'consent',
    });

    res.redirect(authorizeUrl);
});

let accessToken: string | null = null;
let refreshToken: string | null = null;
let expiryDate: Date | null = null;

app.get('/oauth/2.0/callback', (req, res) => {
    const code = req.query.code as string;
    consumer.getOAuthAccessToken(
        code,
        {
            grant_type: 'authorization_code',
            redirect_uri: redirectUrl,
        },
        (err, token, refresh_token, result) => {
            if (err) {
                console.error(err);
                return res.send('Failed to retrieve access token!');
            }

            // Save these somewhere - they will be needed to make requests to Jira
            accessToken = token;
            refreshToken = refresh_token;
            expiryDate = new Date(Date.now() + result.expires_in * 1000);

            console.log('ACCESS TOKEN:', accessToken);
            console.log('REFRESH TOKEN:', refreshToken);
            console.log(result);
            res.send('Token saved');
        }
    );
});

interface IAccessibleResource {
    id: string;
    url: string;
}

app.get('/issue/:issueId', (req, res) => {
    if (!accessToken || !refreshToken || !expiryDate) {
        return res.send('OAuth token is not configured!');
    }

    consumer.getOAuthAccessToken(
        refreshToken,
        {
            grant_type: 'refresh_token',
            redirect_uri: redirectUrl,
        },
        async (err, token, refresh_token, result) => {
            if (err) {
                console.error(err);
                return res.send('Failed to retrieve access token!');
            }

            accessToken = token;
            refreshToken = refresh_token;
            expiryDate = new Date(Date.now() + result.expires_in * 1000);

            const authHeader = consumer.buildAuthHeader(accessToken);

            const accessibleResourcesResponse = await axios.get<IAccessibleResource[]>(
                'https://api.atlassian.com/oauth/token/accessible-resources',
                {
                    headers: {
                        Accept: 'application/json',
                        Authorization: authHeader,
                    },
                }
            );

            const appId = accessibleResourcesResponse.data.find((d) => d.url === jiraUrl)?.id;
            if (!appId) {
                return res.send('App is not accessible.');
            }

            const apiUrl = `rest/api/2/issue/${req.params.issueId}`;
            const requestUrl = `https://api.atlassian.com/ex/jira/${appId}/${apiUrl}`;
            const response = await axios.get(requestUrl, {
                headers: {
                    Authorization: authHeader,
                },
            });

            res.send(response.data);
        }
    );
});

export default app;
