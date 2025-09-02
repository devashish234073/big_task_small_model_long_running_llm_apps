// Description: This Node.js script connects to a PostgreSQL database, fetches all tables,
// sends the data from each table to a locally running Ollama model for analysis via HTTP,
// executes the SQL queries provided by the model, and then performs cross-table analysis
// to generate meaningful join queries based on accumulated insights.
const { Client } = require('pg');
const http = require('http');

const dbName = process.argv[2];
const modelName = process.argv[3] || 'qwen3:1.7b';

if (!dbName) {
    console.error('Error: Please provide a database name as the first argument.');
    console.error('Usage: node run_queries.js <database_name> [model_name]');
    process.exit(1);
}

// Helper function to send requests to Ollama
async function sendOllamaRequest(payload, options) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let completeResponse = '';
            console.log('\t--- Streaming Response ---');

            res.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                const lines = chunkStr.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const jsonChunk = JSON.parse(line);
                        if (jsonChunk.message && jsonChunk.message.content) {
                            // Log the streaming content to console
                            process.stdout.write(jsonChunk.message.content);
                            completeResponse += jsonChunk.message.content;
                        }

                        // Check if this is the final chunk
                        if (jsonChunk.done) {
                            console.log('\n\t--- End of Stream ---');
                            resolve(completeResponse);
                        }
                    } catch (e) {
                        // Skip invalid JSON lines
                        continue;
                    }
                }
            });

            res.on('end', () => {
                if (completeResponse === '') {
                    reject(new Error('No response received from Ollama'));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(payload);
        req.end();
    });
}

// Main async function to run the application
async function main() {
    const client = new Client({
        user: 'postgres',
        host: 'localhost', // or your database host
        database: dbName,
        password: 'postgres',
        port: 5432,
    });

    // Array to store insights from all tables
    const allInsights = [];

    try {
        // Connect to the database
        await client.connect();
        console.log(`Connected to the database: ${dbName}`);

        // Get all table names from the public schema
        const tablesQuery = `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE';
        `;
        const tablesResult = await client.query(tablesQuery);
        const tables = tablesResult.rows.map(row => row.table_name);

        console.log('Found tables:', tables.join(', '));
        console.log('---');

        // Phase 1: Individual table analysis
        console.log('=== PHASE 1: INDIVIDUAL TABLE ANALYSIS ===\n');

        for (const tableName of tables) {
            console.log(`Analyzing table: ${tableName}`);

            // Get table schema information
            const schemaQuery = `
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = $1 AND table_schema = 'public'
                ORDER BY ordinal_position;
            `;
            const schemaResult = await client.query(schemaQuery, [tableName]);
            const schema = schemaResult.rows;

            // Fetch sample data from the current table
            const dataQuery = `SELECT * FROM "${tableName}" LIMIT 10`;
            const dataResult = await client.query(dataQuery);
            const tableData = dataResult.rows;

            // Prepare the prompt for the Ollama model
            const prompt = `
                I have the following data from a database table named "${tableName}":

                Schema:
                ${JSON.stringify(schema, null, 2)}

                Sample Data:
                ${JSON.stringify(tableData, null, 2)}

                Please analyze this data and provide a key insight or observation about it, including table and column names.
                Then, provide a single, working SQL SELECT query that supports your insight.
                Your response must be a valid JSON object with two fields:
                - "insight": a string containing your analysis.
                - "queries": a list containing SQL queries(max 3) to get various insights like max, min average, etc along with labels, so each query element will look like {"query": "SQL_QUERY_HERE", "label": "DESCRIPTION_HERE"}
            `;

            const ollamaPayload = JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                think: false,
                options: {
                    temperature: 0,
                    think: false,
                },
            });

            const ollamaOptions = {
                hostname: 'localhost',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(ollamaPayload),
                },
            };

            // Handle streaming response from Ollama
            const streamingResponse = await sendOllamaRequest(ollamaPayload, ollamaOptions);

            try {
                // Parse the complete JSON response from the model
                const modelResponse = JSON.parse(streamingResponse);
                const insight = modelResponse.insight;
                const supportingQuery = modelResponse.queries;

                console.log(`\n\tOllama Insight: ${insight}`);
                console.log(`\tOllama Suggested Query: ${supportingQuery}`);

                // Store the insight with table information
                allInsights.push({
                    tableName,
                    insight,
                    queries: supportingQuery,
                    schema
                });

                // Execute the query provided by the model
                if (supportingQuery && supportingQuery.length > 0) {
                    try {
                        for (let i = 0; i < supportingQuery.length; i++) {
                            console.log(`\tExecuting '${supportingQuery[i].query}'`);
                            const supportQueryResult = await client.query(supportingQuery[i].query);
                            console.log(`\t${supportingQuery[i].label}:`);
                            console.table(supportQueryResult.rows);
                        }
                    } catch (queryError) {
                        console.error(`\tError executing the suggested query:`, queryError.message);
                    }
                }
            } catch (parseError) {
                console.error(`\n\tError parsing model response as JSON:`, parseError.message);
                console.log(`\tRaw response: ${streamingResponse}`);

                // Store basic info even if parsing failed
                allInsights.push({
                    tableName,
                    insight: 'Failed to parse insight',
                    query: null,
                    schema
                });
            }

            console.log('---');
        }

        // Phase 2: Cross-table analysis
        console.log('\n=== PHASE 2: CROSS-TABLE ANALYSIS ===\n');
        console.log('Generating join queries based on accumulated insights...\n');

        // Prepare comprehensive prompt for cross-table analysis
        const crossTablePrompt = `
            I have analyzed multiple database tables and gathered the following insights:

            ${allInsights.map((insight, index) => `
            Table ${index + 1}: ${insight.tableName}
            Schema: ${JSON.stringify(insight.schema, null, 2)}
            Insight: ${insight.insight}
            Individual Query: ${insight.query}
            `).join('\n')}

            Based on these individual table insights and schemas, please:
            1. Identify potential relationships between tables based on common column names or logical connections
            2. Generate 3-5 meaningful JOIN queries that combine data from multiple tables to reveal deeper insights
            3. Each query should be designed to answer a specific business question or reveal a pattern across tables

            Your response must be a valid JSON object with this structure:
            {
                "relationships": ["List of identified relationships between tables"],
                "queries": [
                    {
                        "description": "What this query reveals",
                        "sql": "The actual JOIN query",
                        "business_value": "Why this insight is valuable"
                    }
                ]
            }
        `;

        const crossTablePayload = JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: crossTablePrompt }],
            stream: true,
            think: false,
            options: {
                temperature: 0.1,
                think: false,
            },
        });

        const crossTableOptions = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(crossTablePayload),
            },
        };

        console.log('Analyzing cross-table relationships and generating JOIN queries...');
        const crossTableResponse = await sendOllamaRequest(crossTablePayload, crossTableOptions);

        try {
            const crossTableAnalysis = JSON.parse(crossTableResponse);

            console.log('\n=== IDENTIFIED RELATIONSHIPS ===');
            if (crossTableAnalysis.relationships) {
                crossTableAnalysis.relationships.forEach((relationship, index) => {
                    console.log(`${index + 1}. ${relationship}`);
                });
            }

            console.log('\n=== CROSS-TABLE INSIGHTS & QUERIES ===');
            if (crossTableAnalysis.queries) {
                for (let i = 0; i < crossTableAnalysis.queries.length; i++) {
                    const queryInfo = crossTableAnalysis.queries[i];
                    console.log(`\n--- Query ${i + 1} ---`);
                    console.log(`Description: ${queryInfo.description}`);
                    console.log(`Business Value: ${queryInfo.business_value}`);
                    console.log(`SQL Query: ${queryInfo.sql}`);

                    // Execute the cross-table query
                    if (queryInfo.sql) {
                        try {
                            console.log(`\nExecuting cross-table query...${queryInfo.sql}`);
                            const crossQueryResult = await client.query(queryInfo.sql);
                            console.log('Results:');
                            console.table(crossQueryResult.rows);
                        } catch (queryError) {
                            console.error(`Error executing cross-table query:`, queryError.message);
                        }
                    }
                    console.log('---');
                }
            }

        } catch (parseError) {
            console.error('Error parsing cross-table analysis:', parseError.message);
            console.log('Raw response:', crossTableResponse);
        }

    } catch (err) {
        console.error('An error occurred:', err.message);
    } finally {
        // Always close the database connection
        await client.end();
        console.log('\nDatabase connection closed.');
        console.log('\n=== ANALYSIS COMPLETE ===');
        console.log(`Total tables analyzed: ${allInsights.length}`);
        console.log('Individual insights collected and cross-table analysis performed.');
    }
}

// Run the main function
main();