const AWS = require('aws-sdk');
const axios = require('axios');
const dns = require('dns');
const envalid = require('envalid');

const config = envalid.cleanEnv(process.env, {
  NODE_ENV: envalid.str({ choices: ['development', 'production'] }),
  AWS_ACCESS_KEY_ID: envalid.str(),
  AWS_SECRET_ACCESS_KEY: envalid.str(),
  HOSTED_ZONE_ID: envalid.str(),
  TARGET_HOSTNAME: envalid.str(),
  SYNC_PERIOD_SECONDS: envalid.num(),
});

if (config.isProduction) {
  setTimeout(() => synchronize(), config.SYNC_PERIOD_SECONDS * 1000);
} 

if (config.isDevelopment) {
  synchronize();
}

async function synchronize() {
  console.info('synchronize started');
  const localIp = await getLocalIp();
  const remoteIp = await getRemoteIp();
  if (localIp === remoteIp) { return; }
  console.info(`new public ip detected for "${config.TARGET_HOSTNAME}", "${remoteIp}" -> "${localIp}"`);
  await updateRemoteIp(localIp);
}

async function getLocalIp() {
  let response;
  try {
    response = await axios.get('https://ipv4bot.whatismyipaddress.com');
  } catch (error) {
    console.error(error.message);
    throw new Error('failed to get public ip');
  }
  const ip = response.data;
  return ip;
}

async function getRemoteIp() {
  return new Promise((resolve, reject) => dns.lookup(config.TARGET_HOSTNAME, 4, (err, ip) => {
    if (err) { 
      if (err.code !== 'ENOTFOUND') {
        console.error(err);
        reject(err);
        return;
      }
      resolve('0.0.0.0');
      return;
    };
    resolve(ip);
  }));
}

async function updateRemoteIp(newIp) {
  const route53 = new AWS.Route53({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    apiVersion: '2013-04-01',
  });
  const params = {
    ChangeBatch: {
      Changes: [
        {
          Action: "UPSERT", 
          ResourceRecordSet: {
            Name: config.TARGET_HOSTNAME, 
            ResourceRecords: [{ Value: newIp }], 
            TTL: 60, 
            Type: "A"
          }
        }
      ], 
      Comment: "Updated via dynamic-dns-daemon"
    }, 
    HostedZoneId: config.HOSTED_ZONE_ID,
  };
  await route53.changeResourceRecordSets(params).promise();
}
