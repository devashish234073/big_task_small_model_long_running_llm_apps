# big_task_small_model_long_running_llm_apps
This application uses smallers models from ollama to do bigger tasks it can't do correctly in a single prompt by asking it to do it in multiple prompts

## Pre-requisite
1. install ollama from https://ollama.com/download
2. download qwen3 model from ollama run qwen3:1.7b
3. install node and java for the respective tools
4. install postgresdb server in your local

# To run pg2_db_explorer

```
git clone https://github.com/devashish234073/big_task_small_model_long_running_llm_apps
cd big_task_small_model_long_running_llm_apps
npm install
node pg2_db_explorer.js postgres
```

For the provided database name from the command line arg it runs:
steps that it runs:

1. [node] run a query to list all the tables 
2. [node] sends the first table to the model and asks for structured queries to get some insight out of the current table
3. [model] returns the list of queries to run with label and "insights"
4. [node] sends next table from the db to the model
5. [model] repeats #3
6. [node] once all tables are analyzed insights from all the tables are sent back to the model to share join queries to get further analysis
7. [model] returns list of join queries with business values for each
8. [node] run the join queries and "collects the data"
9. [node] sends the collected data back to the model to share a final insights
10. [model] returns a summarized insight from all the data of join query shared from above.

<img width="1422" height="1020" alt="image" src="https://github.com/user-attachments/assets/5ac1611f-2944-40c0-90d4-5fb20f987ca0" />

# For details of springboot-app-analyzer.js refer to this post:

https://www.linkedin.com/posts/devashish-priyadarshi-96554112b_llm-springboot-codeabrfixabrusingabrllm-activity-7370695859153522688-Hiq0?utm_source=share&utm_medium=member_desktop&rcm=ACoAAB_v_B0B3953zoesstM-BJmeuZA94BtFpDI

Sample Output :
<img width="859" height="588" alt="image" src="https://github.com/user-attachments/assets/ccb7aaef-d156-438c-93bf-74c274be9d28" />

# To run java_feature_explorer

```
git clone https://github.com/devashish234073/big_task_small_model_long_running_llm_apps
cd big_task_small_model_long_running_llm_apps
npm install
node java_feature_explorer.js 17
```

Asks for list of features first, sends the features one by one back to the model to share a class showing demo of that feature, 
on receiving the implemented class it compiles and runs that using locally installed javac and java tools.

<img width="1361" height="794" alt="image" src="https://github.com/user-attachments/assets/50b9ae1a-21de-49cf-89f7-410d26ce9088" />

Implemented classes gets stored in its respective version folder from where its compiled and run:

<img width="754" height="687" alt="image" src="https://github.com/user-attachments/assets/f39a861c-72b3-4b78-aadd-d35aec611d34" />

