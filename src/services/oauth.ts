import axios from 'axios'

// Google OAuth
export async function verifyGoogleToken(code: string) {
  // Exchange code for tokens
  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  })

  const { access_token } = tokenRes.data

  // Get user info
  const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  })

  return userRes.data as {
    id: string
    email: string
    name: string
    picture: string
  }
}

export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'email profile',
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// Facebook OAuth
export async function verifyFacebookToken(code: string) {
  // Exchange code for access token
  const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
      code,
    },
  })

  const { access_token } = tokenRes.data

  // Get user info
  const userRes = await axios.get('https://graph.facebook.com/me', {
    params: {
      fields: 'id,name,email,picture',
      access_token,
    },
  })

  return userRes.data as {
    id: string
    email: string
    name: string
    picture: { data: { url: string } }
  }
}

export function getFacebookAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID!,
    redirect_uri: process.env.FACEBOOK_REDIRECT_URI!,
    scope: 'email,public_profile',
    response_type: 'code',
  })
  return `https://www.facebook.com/v18.0/dialog/oauth?${params}`
}
