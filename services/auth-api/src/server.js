const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const port = process.env.PORT || 3002;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleIssuer = process.env.GOOGLE_ISSUER || "https://accounts.google.com";
const defaultRedirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5173/auth/callback";

const appJwtSecret = process.env.APP_JWT_SECRET || "change-me-in-production";
const appJwtIssuer = process.env.KONG_JWT_ISSUER || "fusca-app";
const appJwtAudience = process.env.APP_JWT_AUDIENCE || "fusca-api";
const appJwtExpiresIn = process.env.APP_JWT_EXPIRES_IN || "1h";

const oauthClient = new OAuth2Client(googleClientId);

function requireGoogleConfig(res) {
  if (!googleClientId || !googleClientSecret) {
    res.status(500).json({
      error: "google_config_missing",
      message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
    });
    return false;
  }
  return true;
}

function parseExpiresToSeconds(value) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) {
    return 3600;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 3600;
  return amount * 86400;
}

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "auth-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/google/url", (req, res) => {
  if (!requireGoogleConfig(res)) return;

  const redirectUri = req.query.redirect_uri || defaultRedirectUri;
  const state = req.query.state || "fusca-state";

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.status(200).json({ auth_url: authUrl });
});

app.post("/google/exchange", async (req, res) => {
  if (!requireGoogleConfig(res)) return;

  const { code, redirectUri, codeVerifier } = req.body || {};
  if (!code) {
    res.status(400).json({ error: "invalid_request", message: "code is required" });
    return;
  }

  const tokenBody = new URLSearchParams({
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: redirectUri || defaultRedirectUri,
    grant_type: "authorization_code",
  });

  if (codeVerifier) {
    tokenBody.set("code_verifier", codeVerifier);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      res.status(400).json({
        error: "google_token_exchange_failed",
        details: tokenData,
      });
      return;
    }

    const idToken = tokenData.id_token;
    if (!idToken) {
      res.status(400).json({
        error: "google_id_token_missing",
        message: "Google response did not contain id_token",
      });
      return;
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload || payload.iss !== googleIssuer) {
      res.status(401).json({ error: "invalid_google_token" });
      return;
    }

    const user = {
      id: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      name: payload.name,
      picture: payload.picture,
    };

    const appToken = jwt.sign(
      {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        provider: "google",
      },
      appJwtSecret,
      {
        algorithm: "HS256",
        issuer: appJwtIssuer,
        audience: appJwtAudience,
        expiresIn: appJwtExpiresIn,
      },
    );

    res.status(200).json({
      access_token: appToken,
      token_type: "Bearer",
      expires_in: parseExpiresToSeconds(appJwtExpiresIn),
      user,
    });
  } catch (error) {
    res.status(500).json({
      error: "token_exchange_error",
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`auth-api running on port ${port}`);
});
