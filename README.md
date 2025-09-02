# big_task_small_model_long_running_llm_apps
This application uses smallers models from ollama to do bigger tasks it can't do correctly in a single prompt by asking it to do it in multiple prompts

# To run pg2_db_explorer

```
git clone https://github.com/devashish234073/big_task_small_model_long_running_llm_apps
cd big_task_small_model_long_running_llm_apps
npm install
node pg2_db_explorer.js postgres
```

For the provided database name from the command line arg it first gets all the tables by running a postgres query and then runs select query on each table,
sends the data to the model to analyze and share insights and query to see that insight.
All such insights are stored in a list and at the end all the collected insights are shared back to the model to return join queries, which the application then runs again

<img width="1422" height="1020" alt="image" src="https://github.com/user-attachments/assets/5ac1611f-2944-40c0-90d4-5fb20f987ca0" />


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

