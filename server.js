const express = require('express');
const cors = require('cors');
const path = require('path');
const dns = require('dns').promises;
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3000);
const envCandidates = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGO_DIRECT_URI: process.env.MONGO_DIRECT_URI,
  DATABASE_URL: process.env.DATABASE_URL,
  MONGO_URL: process.env.MONGO_URL,
  MONGODB_URL: process.env.MONGODB_URL,
  ATLAS_URI: process.env.ATLAS_URI,
  RAILWAY_MONGODB_URI: process.env.RAILWAY_MONGODB_URI,
};

function findMongoUriFromEnv() {
  const mongodbRegex = /^mongodb(?:\+srv)?:\/\//i;
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && mongodbRegex.test(value)) {
      console.log(`Detected MongoDB URI from env var: ${key}`);
      return { key, value };
    }
  }
  return null;
}

const detectedMongo = findMongoUriFromEnv();
const MONGO_URI = envCandidates.MONGO_DIRECT_URI || envCandidates.MONGODB_URI || envCandidates.DATABASE_URL || envCandidates.MONGO_URL || envCandidates.MONGODB_URL || envCandidates.ATLAS_URI || envCandidates.RAILWAY_MONGODB_URI || detectedMongo?.value;
const DB_NAME = process.env.DB_NAME || 'agromin';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'states';

if (!MONGO_URI) {
  console.error('ERROR: MongoDB connection string is not configured. Set one of the supported env vars or add a MongoDB URI as any environment variable.');
  console.error('Supported keys:', Object.keys(envCandidates).join(', '));
  console.error('Loaded env path:', path.join(__dirname, '.env'));
  Object.entries(envCandidates).forEach(([key, value]) => {
    console.error(`${key}:`, value ? '[SET]' : '[UNDEFINED]');
  });
  if (detectedMongo) {
    console.error(`Detected candidate env var: ${detectedMongo.key}`);
  } else {
    console.error('No MongoDB URI-like value found in environment variables.');
  }
  console.error('If your environment blocks SRV DNS lookups, set MONGO_DIRECT_URI with a direct cluster host list.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));

async function createClient(uri) {
  return new MongoClient(uri, {
    serverApi: {
      version: '1',
      strict: true,
      deprecationErrors: true,
    },
    tls: true,
    tlsAllowInvalidCertificates: true,
    tlsAllowInvalidHostnames: true,
    connectTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });
}

let client;
let collection;

async function buildDirectUriFromSrv(uri) {
  try {
    const match = uri.match(/^mongodb\+srv:\/\/(.+?)@(.+?)(?:\/(.*))?$/i);
    if (!match) return null;
    const userPass = match[1];
    const host = match[2];
    const dbAndParams = match[3] || '';
    const [dbName, query] = dbAndParams.split('?');
    const srvName = `_mongodb._tcp.${host}`;
    const records = await dns.resolveSrv(srvName);
    const hosts = records.map(r => `${r.name}:${r.port}`).join(',');
    const queryString = query ? `?${query}` : '';
    return `mongodb://${userPass}@${hosts}/${dbName || 'agromin'}${queryString}`;
  } catch (err) {
    console.warn('Failed to build direct Mongo URI from SRV:', err.message || err);
    return null;
  }
}

async function connectToDatabase() {
  client = await createClient(MONGO_URI);
  try {
    await client.connect();
  } catch (firstErr) {
    console.warn('First MongoDB connection attempt failed.');
    if (MONGO_URI.startsWith('mongodb+srv://')) {
      console.warn('Attempting SRV fallback for mongodb+srv URI...');
      const directUri = await buildDirectUriFromSrv(MONGO_URI);
      if (directUri) {
        console.warn('Using direct MongoDB URI fallback:', directUri.replace(/:[^:@]+@/, ':*****@'));
        client = await createClient(directUri);
        await client.connect();
      } else {
        console.error('SRV lookup failed. If your network blocks SRV DNS, set MONGO_DIRECT_URI in your environment with direct cluster hosts.');
        throw firstErr;
      }
    } else {
      throw firstErr;
    }
  }

  const db = client.db(DB_NAME);
  collection = db.collection(COLLECTION_NAME);
  await collection.createIndex({ userKey: 1 }, { unique: true });
  console.log(`Connected to MongoDB database '${DB_NAME}', collection '${COLLECTION_NAME}'.`);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/state/:userKey', async (req, res) => {
  try {
    const userKey = req.params.userKey;
    if (!userKey) {
      return res.status(400).json({ error: 'Missing userKey' });
    }
    const doc = await collection.findOne({ userKey });
    if (!doc) {
      return res.status(404).json({ message: 'state not found' });
    }
    return res.json({ state: doc.state, updatedAt: doc.updatedAt });
  } catch (error) {
    console.error('GET /state error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/state/:userKey', async (req, res) => {
  try {
    const userKey = req.params.userKey;
    const { state } = req.body;
    if (!userKey) {
      return res.status(400).json({ error: 'Missing userKey' });
    }
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid state payload' });
    }

    const updatedAt = new Date();
    await collection.updateOne(
      { userKey },
      { $set: { state, updatedAt } },
      { upsert: true }
    );

    return res.json({ status: 'ok', userKey, updatedAt });
  } catch (error) {
    console.error('POST /state error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

connectToDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started at http://localhost:${PORT}`);
      console.log('Open index.html from this server or use the same host for API requests.');
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
