const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'agromin';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'states';

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI is not configured. Copy .env.example to .env and set your MongoDB Atlas connection string.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));

const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true,
  },
});

let collection;

async function connectToDatabase() {
  await client.connect();
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
