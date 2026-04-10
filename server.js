const express = require('express');
const cors = require('cors');
const neo4j = require('neo4j-driver');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const uri = process.env.NEO4J_URI || "neo4j+s://80ae8eeb.databases.neo4j.io";
const user = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

// 1. Initialize default user on startup
async function initDatabase() {
    const session = driver.session();
    try {
        await session.run(`
            MERGE (u:User {email: 'jayasreementhi@gmail.com'})
            ON CREATE SET u.name = 'Jayasree', u.password = 'Loveuma@143'
        `);
        console.log("Database initialized with default user: jayasreementhi@gmail.com");
    } catch (error) {
        console.error("Error initializing DB:", error.message);
    } finally {
        await session.close();
    }
}
initDatabase();

// 2 & 6. Create User
app.post('/create-user', async (req, res) => {
    const { name, email, password } = req.body;
    if(!name || !email || !password) return res.status(400).json({error: "Name, email, and password required"});
    
    const session = driver.session();
    try {
        const result = await session.run(
            `MERGE (u:User {email: $email}) 
             ON CREATE SET u.name = $name, u.password = $password 
             RETURN u`,
            { name, email, password }
        );
        res.json({ message: "User created successfully", user: result.records[0].get('u').properties });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await session.close();
    }
});

// 3 & 6. Add Food
app.post('/add-food', async (req, res) => {
    const { name, category } = req.body;
    if(!name || !category) return res.status(400).json({error: "Food name and category required"});
    
    const session = driver.session();
    try {
        const result = await session.run(
            `MERGE (f:Food {name: $name}) 
             ON CREATE SET f.category = $category 
             RETURN f`,
            { name, category }
        );
        res.json({ message: "Food added", food: result.records[0].get('f').properties });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await session.close();
    }
});

// 4, 5, 6. Like Food (Main Logic)
app.post('/like-food', async (req, res) => {
    const { email, foodName } = req.body;
    if(!email || !foodName) return res.status(400).json({error: "Email and foodName required"});

    const session = driver.session();
    try {
        // Cypher Query to enforce rules:
        // 1. Create [:LIKES] relationship between User and Food.
        // 2. Identify if any OTHER user likes this food, and if either the primary or other user is 'jayasreementhi@gmail.com', create a [:COMMON_LIKE] relationship between them.
        
        const bidirectionalQuery = `
            MATCH (u:User {email: $email})
            MATCH (f:Food {name: $foodName})
            MERGE (u)-[:LIKES]->(f)
            WITH u, f
            // Find anyone else who likes this food, where one of them is the default user
            OPTIONAL MATCH (other:User)-[:LIKES]->(f)
            WHERE u <> other AND (u.email = 'jayasreementhi@gmail.com' OR other.email = 'jayasreementhi@gmail.com')
            // If match is found, establish common like
            CALL {
                WITH u, other
                WITH u, other WHERE other IS NOT NULL
                MERGE (u)-[c:COMMON_LIKE]-(other)
                RETURN c
            }
            RETURN u, f
        `;
        
        await session.run(bidirectionalQuery, { email, foodName });

        res.json({ message: "Food liked and conditional graph relationships updated!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await session.close();
    }
});

// 6 & 8. Graph Data Endpoint
app.get('/graph', async (req, res) => {
    const session = driver.session();
    try {
        // Extracting pure node/link data from the graph
        const result = await session.run(`
            MATCH (n)
            OPTIONAL MATCH (n)-[r]->(m)
            RETURN n, r, m
        `);
        
        const nodes = [];
        const links = [];
        const nodeMap = new Set();
        
        result.records.forEach(rc => {
            const n = rc.get('n');
            const r = rc.get('r');
            const m = rc.get('m');
            
            // In neo4j library >v5, elementId is the standard unique id field
            const getId = (node) => node.elementId || node.identity?.low;
            
            if (n && !nodeMap.has(getId(n))) {
                nodes.push({ id: getId(n), labels: n.labels, properties: n.properties });
                nodeMap.add(getId(n));
            }
            if (m && !nodeMap.has(getId(m))) {
                nodes.push({ id: getId(m), labels: m.labels, properties: m.properties });
                nodeMap.add(getId(m));
            }
            if (r) {
                // Ensure duplicate relationships aren't drawn (since undirected relationships show up twice)
                links.push({
                    source: getId(r.startNode) || r.startNodeElementId,
                    target: getId(r.endNode) || r.endNodeElementId,
                    type: r.type,
                    properties: r.properties
                });
            }
        });
        
        // Basic deduction of duplicate relationship parsing
        const uniqueLinks = links.filter((v,i,a)=>a.findIndex(v2=>(v2.source===v.source && v2.target===v.target && v2.type===v.type))===i);

        res.json({ nodes, relationships: uniqueLinks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await session.close();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
