const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let MODEL = process.argv[3] || "qwen3:1.7b";
let JAVA_VERSION = process.argv[2] || "17";
const API_HOST = "localhost";
const API_PORT = 11434;

const OUTPUT_DIR = path.join(__dirname, `java${JAVA_VERSION}_features`);

// Function to send prompt to Ollama API with streaming
function runOllama(prompt) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: "/api/generate",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      let output = "";
      
      res.on("data", (chunk) => {
        // Ollama streams JSON objects line by line
        const lines = chunk.toString().split("\n").filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              // Stream each word/chunk as it arrives
              process.stdout.write(data.response);
              output += data.response;
            }
          } catch (err) {
            console.error("⚠️ JSON parse error:", err.message);
          }
        }
      });

      res.on("end", () => {
        console.log("\n"); // Add newline after streaming completes
        resolve(output.trim());
      });
    });

    req.on("error", (err) => reject(err));
    req.write(JSON.stringify({ model: MODEL, prompt, stream: true, think: false }));
    req.end();
  });
}

// Function to compile and run a single Java file
function compileAndRun(fileName) {
  try {
    const filePath = path.join(OUTPUT_DIR, fileName);
    const className = path.parse(fileName).name;

    console.log(`\n⚙️ Compiling ${fileName}...`);
    execSync(`javac "${filePath}"`, { cwd: OUTPUT_DIR, stdio: "inherit" });
    console.log("✅ Compilation successful.");

    console.log(`\n🚀 Running ${className}...`);
    execSync(`java ${className}`, { cwd: OUTPUT_DIR, stdio: "inherit" });
    console.log("✅ Execution successful.");
    return true; // Success
  } catch (err) {
    console.error(`❌ Operation failed for ${fileName}.`);
    console.error(err.message);
    return false; // Failure
  }
}

// === Main workflow ===
(async () => {
  try {
    // 1. Get a list of Java ${JAVA_VERSION} features
    const featuresPrompt = `List the names of all most popular new features in Java ${JAVA_VERSION}. Only list the names, one per line.`;
    console.log(`Asking for Java ${JAVA_VERSION} features...`);
    const featuresOutput = await runOllama(featuresPrompt);
    
    // Clean and parse the list of features
    const featureNames = featuresOutput
      .split("\n")
      .map(name => name.trim())
      .filter(name => name.length > 0 && !name.startsWith("```"));

    if (featureNames.length === 0) {
      console.error("❌ Failed to get a list of features from Ollama.");
      return;
    }

    console.log(`\nFound ${featureNames.length} features: ${featureNames.join(", ")}`);

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR);
    }

    // 2. Loop through each feature to generate, compile, and run a class
    for (const featureName of featureNames) {
      let codePrompt = `Provide a complete, self-contained Java class with a main method that demonstrates the "${featureName}" feature from Java ${JAVA_VERSION}. The class should be named based on the feature, like "SealedClassesExample". Only output the raw Java code.`;
      
      let attempt = 0;
      const MAX_ATTEMPTS = 3;
      let isSuccessful = false;

      while (!isSuccessful && attempt < MAX_ATTEMPTS) {
        attempt++;
        console.log(`\n[Attempt ${attempt}/${MAX_ATTEMPTS}] Generating code for: ${featureName}...`);
        
        let javaCode = await runOllama(codePrompt);
        
        // Remove markdown code fences if present
        javaCode = javaCode.replace(/```java\n|```/g, "").trim();

        // Dynamically determine the class name for the file
        const classNameMatch = javaCode.match(/public class (\w+)/);
        if (!classNameMatch) {
          console.error(`❌ Could not determine class name for feature: ${featureName}`);
          break;
        }

        const className = classNameMatch[1];
        const fileName = `${className}.java`;
        fs.writeFileSync(path.join(OUTPUT_DIR, fileName), javaCode, "utf-8");
        console.log(`✍️ Wrote file: ${fileName}`);

        isSuccessful = compileAndRun(fileName);

        if (!isSuccessful) {
          console.log(`\n❌ Error detected. Requesting fix from Ollama...`);
          const fixPrompt = `The following Java code failed to compile or run with an error. Please provide the corrected code.
Error details were: (check the previous console output)
Original code:
\`\`\`java
${javaCode}
\`\`\`
Return only the corrected, raw Java code.`;
          codePrompt = fixPrompt; // Use the fix prompt for the next iteration
        }
      }

      if (isSuccessful) {
        console.log(`\n🎉 Successfully compiled and ran code for: ${featureName}`);
      } else {
        console.log(`\n⚠️ Failed to fix the code for "${featureName}" after ${MAX_ATTEMPTS} attempts. Moving to the next feature.`);
      }
    }

    console.log("\n🏁 Workflow complete. All features processed.");

  } catch (err) {
    console.error("A fatal error occurred:", err);
  }
})();
