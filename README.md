# Jira OAuth 1.0/2.0 examples

# How to

## OAuth 1.0 for incoming communication (App -> Jira)

### Jira configuration

1. Generate a pair of RSA keys:

    ```
    openssl genrsa -out jira_privatekey.pem 1024
    openssl req -newkey rsa:1024 -x509 -key jira_privatekey.pem -out jira_publickey.cer -days 365
    openssl x509 -pubkey -noout -in jira_publickey.cer  > jira_publickey.pem
    ```

1. Go to "Connected apps" in Jira. On cloud, this is accessible through Cog > Products > Application links. Alternatively, you can enter this URL: https://replace-this.atlassian.net/plugins/servlet/applinks/listApplicationLinks

1. Enter any URL. You can enter your app URL, but as you are configuring inbound communication, it does not matter. It will be shown in the app settings though. Press "Continue" if an error appears.

1. Fill "Application Name". Leave "Application Type" set to "Generic Application". Make sure to check the "Create incoming link". Press "Continue".

1. Fill the consumer key and name. Consumer name can be any arbitrary name. Consumer key will be required for OAuth token generation. In the "Public key" field, paste the previously generated public key (`jira_publickey.pem` in the example).

### App configuration

1. Make sure you have the private key accessible from the app.

1. Install the `oauth` package:

    ```
    npm i oauth
    npm i -D @types/oauth
    ```

1. Create an OAuth consumer:

    ```typescript
    import { OAuth } from 'oauth';

    const pathToPrivateKey = './keys/jira_privatekey.pem';
    const privateKeyData = fs.readFileSync(pathToPrivateKey, 'utf-8');

    const consumerKey = 'YOUR_CONSUMER_KEY_ENTERED_IN_JIRA_CONFIGURATION';

    const jiraUrl = 'https://replace-this.atlassian.net';
    const callbackUrl = 'http://localhost:3000/oauth/1.0/callback';

    const consumer = new OAuth(
        `${jiraUrl}/plugins/servlet/oauth/request-token`,
        `${jiraUrl}/plugins/servlet/oauth/access-token`,
        consumerKey,
        privateKeyData,
        '1.0',
        callbackUrl,
        'RSA-SHA1'
    );
    ```

1. Create a HTTP server. This example uses an `express` server.

    ```
    npm i express express-session
    npm i -D @types/express @types/express-session
    ```

    ```typescript
    import express from 'express';
    import session from 'express-session';

    const sessionSecret = 'secretSessionKey';
    const app = express();
    app.use(session({ secret: sessionSecret }));
    ```

1. Add a connect endpoint. This will be used by the user to request the token from Jira.

    ```typescript
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
    ```

1. Add a callback endpoint. This will be used by Jira to redirect the user to enable the app to retrieve the token.

    ```typescript
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
    ```

### Sample token retrieval

1. Enter the connect URL (in this example, http://your-url.com/oauth/1.0/connect).

1. Press Allow when asked by Jira.

1. You will receive your token and secret on the `consumer.getOAuthAccessToken` method callback.

### Sample token usage

1. To make a request using OAuth, retrieve the token and secret provided by Jira, and get the `Authentication` header from OAuth:

    ```typescript
    const requestUrl = `${jiraUrl}/rest/api/2/issue/${req.params.issueId}`;
    const method = 'get';
    const authHeader = consumer.authHeader(requestUrl, oauthToken, oauthSecret, method);
    ```

1. Use the header in a request:
    ```typescript
    const response = await axios.get(requestUrl, {
        headers: {
            Authorization: authHeader,
        },
    });
    ```

## OAuth 2.0 for incoming communication (App -> Jira)

-   OAuth 2.0 authorization is technically an integration in Jira, that Jira has to approve to enable public usage.
-   OAuth 2.0 tokens are not permanent, they have to be refreshed by refresh tokens.
-   Refresh tokens are not permanent as well. When a refresh token expires, user has to repeat the authorization process again.

### Jira configuration

1. You'll need a public URL with a valid HTTPS/SSL certificate.

1. Go to developer console on https://developer.atlassian.com/console/myapps/.

1. Create an OAuth 2.0 integration.

1. Select "Authorization" in the left menu.

1. Next to "OAuth 2.0 (3LO)", select "Configure".

1. Set the callback URL. It will be required in next steps.

1. Configure required permission scopes in "Permission" in the left menu. These will be the things that your app can access, and for which the user must agree.

### App configuration

1. Install the `oauth` package:

    ```
    npm i oauth
    npm i -D @types/oauth
    ```

1. Create an OAuth consumer:

    ```typescript
    const clientId = 'YOUR_CLIENT_ID';
    const clientSecret = 'YOUR_CLIENT_SECRET';

    const consumer = new OAuth2(clientId, clientSecret, 'https://auth.atlassian.com', '/authorize', '/oauth/token');
    ```

1. Create a HTTP server. This example uses an `express` server.

    ```
    npm i express express-session
    npm i -D @types/express @types/express-session
    ```

    ```typescript
    import express from 'express';
    import session from 'express-session';

    const sessionSecret = 'secretSessionKey';
    const app = express();
    app.use(session({ secret: sessionSecret }));
    ```

1. Add a connect endpoint. This will be used by the user to request the token from Jira.

    ```typescript
    const redirectUrl = 'YOUR_REDIRECT_URL_FROM_OAUTH_CONFIGURATION';
    const scopes = ['read:jira-work', 'read:jira-user']; // Enter your required scopes from the developer console
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
    ```

1. Add a callback endpoint. This will be used by Jira to redirect the user to enable the app to retrieve the token.
   Make sure it is the same as provided in the OAuth 2.0 configuration before.

    ```typescript
    let accessToken: string | null = null;
    app.get('/oauth/2.0/callback', (req, res) => {
        const code = req.query.code as string;
        consumer.getOAuthAccessToken(
            code,
            {
                grant_type: 'authorization_code',
                redirect_uri: redirectUrl,
            },
            (err, token, refreshToken, result) => {
                if (err) {
                    console.error(err);
                    return res.send('Failed to retrieve access token!');
                }

                accessToken = token;
                res.send('Token saved');
            }
        );
    });
    ```

### Sample token retrieval

1. Enter the connect URL (in this example, https://your-url.com/oauth/2.0/connect).

1. Press Allow when asked by Jira.

1. You will receive your token and secret on the `consumer.getOAuthAccessToken` method callback.

### Sample token usage

1.  To make a request using OAuth, retrieve the token provided by Jira, and get the `Authentication` header from OAuth:

    ```typescript
    const authHeader = consumer.buildAuthHeader(accessToken);
    ```

1.  Make a request to Atlassian to retrieve required app id. You can get the app by comparing the URL:

    ```typescript
    interface IAccessibleResource {
        id: string;
        url: string;
    }

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
        throw new Error('App is not accessible.');
    }
    ```

1.  Make a request to Jira. Notice, that the URL you're making a request to is not the Jira's URL.
    You have to prepend the API endpoint with Atlassian API URL:

        ```typescript
        const apiUrl = `rest/api/2/issue/${req.params.issueId}`;
        const requestUrl = `https://api.atlassian.com/ex/jira/${appId}/${apiUrl}`;
        const response = await axios.get(requestUrl, {
            headers: {
                Authorization: authHeader,
            },
        });
        ```

### Refresh tokens

As the issued tokens are short lived, they need to be refreshed. To use refresh tokens, you must complete these steps.

1.  Add `offline_access` scope to initial token request.

    ```typescript
    const scopes = ['read:jira-work', 'read:jira-user', 'offline_access'];
    ```

1.  Request a token in the callback. The callback method in `consumer.getOAuthAccessToken`
    should now have a non-empty `refreshToken` argument:

        ```typescript
        consumer.getOAuthAccessToken(
            code,
            {
                grant_type: 'authorization_code',
                redirect_uri: redirectUrl,
            },
            (err, token, refreshToken, result) => {
                // Refresh token is filled now
            });
        ```

1.  Save the refresh token in a safe place. You'll need it when the token expires.
    To check for token expiration, you can use the `expires_in` field:

    ```typescript
    consumer.getOAuthAccessToken(
        code,
        {
            grant_type: 'authorization_code',
            redirect_uri: redirectUrl,
        },
        (err, token, refreshToken, result) => {
            const expiresIn: number = result.expires_in; // Expiration time in seconds
            const expirationDate = new Date(Date.now() + expiresIn * 1000);
        }
    );
    ```

1.  To refresh the token, invoke the `consumer.getOAuthAccessToken` function,
    but instead of passing `code` as the first parameter, pass the refresh token. Also, change the `grant_type` to `'refresh_token'`:

    ```typescript
    consumer.getOAuthAccessToken(
        refreshToken,
        {
            grant_type: 'refresh_token',
            redirect_uri: redirectUrl,
        },
        async (err, token, refreshToken, result) => {}
    );
    ```

1.  As Atlassian uses rotating refresh tokens exclusively now, you must update your token with the value returned in the callback.
    The previous refresh token will be invalid after refreshing, and cannot be used again.

1.  You can use the refresh token for 90 days before it expires. If you use it, the next token is valid also for 90 days.
    However, the maximum expiration time is 365 days from the first token issuance.
    After the token expires, user must once again complete the authorization process. See [this page](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/#use-a-refresh-token-to-get-another-access-token-and-refresh-token-pair) for more information.

# Running the examples

## Build the project

1. `npm install`

1. `npm run build`

## OAuth 1.0

1. Configure Jira as explained above.

1. Open `config.oauth1.json` and fill the data inside:

    ```jsonc
    {
        "consumerKey": "", // Consumer key from Jira configuration
        "jiraUrl": "", // Jira base URL, without the trailing slash
        "localUrl": "", // URL that your app is available on, without the trailing slash
        "privateKeyPath": "" // Path to the private key .pem file
    }
    ```

1. Run `npm run oauth1`.

1. Run a browser, and go to your app URL. It should redirect you to `/oauth/1.0/connect`, which in turn redirects you to Jira.

## OAuth 2.0

1. Configure Jira as explained above.

1. Open `config.oauth2.json` and fill the data inside:

    ```jsonc
    {
        "clientId": "", // Client key from the OAuth integration
        "clientSecret": "", // Client secret from the OAuth integration
        "localUrl": "", // URL that your app is available on, without the trailing slash
        "jiraUrl": "" // Jira base URL, without the trailing slash
    }
    ```

1. Run `npm run oauth2`.

1. Run a browser, and go to your app URL. It should redirect you to `/oauth/2.0/connect`, which in turn redirects you to Jira.
