import axios from 'axios';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { contentConfig } from '../config';

const oauth = new OAuth({
  consumer: {
    key: contentConfig.twitter.consumerKey,
    secret: contentConfig.twitter.consumerSecret,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  },
});

const token = {
  key: contentConfig.twitter.accessToken,
  secret: contentConfig.twitter.accessTokenSecret,
};

export async function postTweet(text: string): Promise<string | null> {
  const url = 'https://api.x.com/2/tweets';
  const body = { text };

  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: 'POST' }, token)
  );

  const response = await axios.post(url, body, {
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (response.data?.data?.id) {
    console.log(`[Twitter] Tweet posted: ${response.data.data.id}`);
    return response.data.data.id;
  }
  return null;
}
