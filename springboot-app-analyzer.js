// Description: This script analyzes a Spring Boot application by reading its
// source code, summarizing each class, collecting resource file contents,
// and capturing the application's startup log. It then combines all this
// information into a single large prompt to get a final analysis from an LLM.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

// Configuration
const appPath = process.argv[2];
const modelName = process.argv[3] || 'qwen3:1.7b';
const ollamaHost = 'localhost';
const ollamaPort = 11434;
const mvnTimeout = 60000; // 60 seconds

if (!appPath) {
    console.error('Error: Please provide the path to the Spring Boot application folder.');
    console.error('Usage: node analyze_springboot_app.js <app_folder_path> [model_name]');
    process.exit(1);
}

// Helper function to send requests to Ollama
async function sendOllamaRequest(payload) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: ollamaHost,
            port: ollamaPort,
            path: '/api/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = http.request(options, (res) => {
            let completeResponse = '';
            res.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter(line => line.trim());
                for (const line of lines) {
                    try {
                        const jsonChunk = JSON.parse(line);
                        if (jsonChunk.message && jsonChunk.message.content) {
                            // Stream the content directly to the console
                            process.stdout.write(jsonChunk.message.content);
                            completeResponse += jsonChunk.message.content; // Keep this for now to return summary
                        }
                        if (jsonChunk.done) {
                            // Resolve the promise when the stream is complete
                            resolve(completeResponse);
                        }
                    } catch (e) {
                        // Skip invalid JSON lines
                        continue;
                    }
                }
            });
            res.on('end', () => {
                // If the stream ends before a 'done' message, reject
                if (!res.writableEnded) {
                    resolve(completeResponse);
                } else if (completeResponse === '') {
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

// Helper function to recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
            arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, file));
        }
    });
    return arrayOfFiles;
}

// Phase 1: Analyze Java source files and create summaries
async function analyzeJavaFiles(prompt) {
    const javaDir = path.join(appPath, 'src', 'main', 'java');
    console.log(`\n--- Analyzing Java files in ${javaDir} ---`);
    if (!fs.existsSync(javaDir)) {
        console.warn(`Warning: Directory not found: ${javaDir}`);
        return prompt;
    }

    const javaFiles = getAllFiles(javaDir).filter(file => file.endsWith('.java'));
    for (const file of javaFiles) {
        try {
            const fileContent = fs.readFileSync(file, 'utf-8');
            const className = path.basename(file, '.java');
            console.log(`[Processing class: ${className} from path ${file}]`);

            // Prompt to get a 20-word summary of the class
            /*const summaryPrompt = `
                Analyze the following Java class and provide a concise summary, no more than 20 words.
                Do not provide any other information.

                Java Class:
                ${fileContent}
            `;

            const ollamaPayload = JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: summaryPrompt }],
                stream: true,
                think: false
            });

            const summary = await sendOllamaRequest(ollamaPayload);
            console.log(`Summary: ${summary}`);*/

            // Append the summary and content to the main prompt string
            prompt += `\nClass Content:\n${fileContent}\n`;

        } catch (error) {
            console.error(`Error processing file ${file}:`, error.message);
        }
    }
    return prompt;
}

async function collectPomFile(prompt) {
    const pomPath = path.join(appPath, 'pom.xml');
    console.log(`\n--- Collecting Maven POM file from ${pomPath} ---`);

    if (!fs.existsSync(pomPath)) {
        console.warn(`Warning: POM file not found: ${pomPath}`);
        return prompt;
    }

    try {
        const pomContent = fs.readFileSync(pomPath, 'utf-8');
        console.log(`[[Processing Maven POM file: pom.xml]]`);

        // Append the POM file content to the main prompt string
        prompt += `\nThis is my pom.xml (Maven Project Object Model) file followed by the content:\n${pomContent}\n`;

    } catch (error) {
        console.error(`Error processing POM file ${pomPath}:`, error.message);
    }

    return prompt;
}

// Phase 2: Collect resource file contents
async function collectResourceFiles(prompt) {
    const resourceDir = path.join(appPath, 'src', 'main', 'resources');
    console.log(`\n--- Collecting resource files from ${resourceDir} ---`);
    if (!fs.existsSync(resourceDir)) {
        console.warn(`Warning: Directory not found: ${resourceDir}`);
        return prompt;
    }

    const resourceFiles = getAllFiles(resourceDir);
    for (const file of resourceFiles) {
        try {
            const fileContent = fs.readFileSync(file, 'utf-8');
            const fileName = path.basename(file);
            console.log(`[[Processing resource file: ${fileName}]]`);

            // Append the resource file content to the main prompt string
            prompt += `\nThis is my ${fileName} followed by the content:\n${fileContent}\n`;

        } catch (error) {
            console.error(`Error processing file ${file}:`, error.message);
        }
    }
    return prompt;
}

// Phase 3: Run Spring Boot and capture log
async function captureMvnLog() {
    let logs = "";
    console.log('\n--- Running `mvn spring-boot:run` and capturing log ---');
    try {
        const { stdout, stderr, error } = await new Promise((resolve, reject) => {
            // Use 'exec' with a timeout to run and kill the process after a set time
            exec('mvn spring-boot:run', { cwd: appPath, timeout: mvnTimeout }, (error, stdout, stderr) => {
                if (error && error.killed) {
                    console.log(`Maven process timed out after ${mvnTimeout / 1000} seconds. Capturing log...`);
                    resolve({ stdout, stderr });
                } else if (error) {
                    // Log the error but don't reject, so we can still send the prompt
                    console.error('Error running Maven command:', error.message);
                    resolve({ stdout, stderr, error });
                } else {
                    resolve({ stdout, stderr, error });
                }
            });
        });

        if (!stderr && !error) {
            console.warn('Warning: No stderr log captured from Maven run. Exiting.');
            return null;
        }
        const logOutput = stdout + stderr;
        console.log('Log captured successfully.');
        // Append the log to the main prompt string
        logs += `\n\nThis is the Application log output:\n${logOutput}`;
        return logs;

    } catch (error) {
        console.error('An error occurred during log capture:', error.message);
        return logs;
    }
}

// Main async function to run the application
async function main() {
    while (true) {
        let finalPrompt = `Analyze the following Spring Boot application code and error logs.\n\n`;

        try {
            // Step 1: Analyze Java files
            finalPrompt = await analyzeJavaFiles(finalPrompt);

            // Step 2: Collect resource files
            finalPrompt = await collectResourceFiles(finalPrompt);

            // Step 2.1: Collect pom.xml file
            finalPrompt = await collectPomFile(finalPrompt);

            // Step 3: Capture the Spring Boot log
            let logs = await captureMvnLog();
            if (!logs) {
                console.error('No stderr log captured from Maven run. Exiting.');
                return;
            }
            finalPrompt += logs;

            finalPrompt += `\n\n
Analyze the provided code files and error logs. Focus ONLY on the immediate error causing application failure.
Critical Instructions:

ONLY fix the direct cause of the error - do not make unnecessary changes
Read the error message carefully - the fix should directly address what the error states
Preserve existing working functionality - if something works, don't change it
Minimal intervention principle - change only what's broken, nothing more
Do NOT change versions, dependencies, or working configurations unless the error explicitly requires it

Error Analysis Process:

Read the exact error message
Identify which specific operation is failing
Locate the exact method/class where the error occurs
Apply the most direct fix for that specific error
Do NOT modify other files unless they are directly related to the error

Response Format:
json{
  "rootCause": "Exact error message and what specific operation is failing",
  "recommendedSolution": "Why this specific fix addresses the exact error (not generic improvements)",
  "files_to_fix": [
    {
      "file": "exact/file/path/FileName.extension",
      "fileType": "java|properties|sql|xml|yml",
      "fixSummary": "ONLY describe the specific change that fixes the error",
      "fixedCompleteCode": "Complete file content with ONLY the necessary fix applied"
    }
  ]
}
What NOT to do:

Do not change Spring Boot versions unless error explicitly mentions version incompatibility
Do not modify pom.xml unless error is about missing dependencies
Do not change application.properties unless error mentions configuration issues
Do not refactor working code
Do not suggest "best practices" - only fix the error

        Important JSON Guidelines:

        Escape all quotes, newlines, and special characters in code content
        Use \" for quotes inside strings
        Use \\n for newlines
        Use \\ for backslashes
        Ensure the JSON is properly formatted and parsable
        `;

            if (!finalPrompt) {
                console.error('No stderr log captured from Maven run. Exiting.');
                break;
            }

            console.log('\n--- Sending final analysis prompt to the model ---');

            const ollamaPayload = JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: finalPrompt }],
                stream: true,
                think: false
            });

            const finalResponse = await sendOllamaRequest(ollamaPayload);

            console.log('\n--- Final Model Response ---');
            console.log(finalResponse);

            try {
                //parse the response to check if it's valid JSON
                let respJson = JSON.parse(finalResponse);
                if (respJson.files_to_fix && Array.isArray(respJson.files_to_fix)) {
                    console.log('\nFiles to fix as per model response:');
                    respJson.files_to_fix.forEach((fileFix, index) => {
                        console.log(`\n${index + 1}. File: ${fileFix.file}`);
                        console.log(`   Fix Summary: ${fileFix.fixSummary}`);
                        // Optionally, write the fixed code to a new file for review
                        const fixedFilePath = path.join(appPath, path.basename(fileFix.file));
                        fs.writeFileSync(fixedFilePath, fileFix.fixedCompleteCode);
                        console.log(`   Fixed code written to: ${fixedFilePath}`);
                    });
                } else {
                    console.warn('Warning: No files_to_fix array found in the model response.');
                }
            } catch (e) {
                console.error('The response is not valid JSON. Please check the model output.');
                return;
            }

        } catch (err) {
            console.error('\nAn error occurred during the analysis:', err.message);
        }
    }
}

main();
