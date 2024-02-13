import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, 
    SystemMessagePromptTemplate, 
    HumanMessagePromptTemplate  } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { HttpResponseOutputParser } from "langchain/output_parsers";

import { OpenAIEmbeddings } from "@langchain/openai";
import { similarity } from "ml-distance";
import { MemoryVectorStore } from "langchain/vectorstores/memory";

import * as parse from "pdf-parse";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { 
    RecursiveCharacterTextSplitter
} from "langchain/text_splitter";

import { Document } from "@langchain/core/documents";

import { RunnableMap, RunnablePassthrough } from "@langchain/core/runnables";
import { MessagesPlaceholder } from "@langchain/core/prompts";

import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

import { Client } from "langsmith";
import { LangChainTracer } from "langchain/callbacks";


const openAIApiKey = "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"; 


// const langSmith = new Client();



/// Setup OpenAI API
console.log("Setting up OpenAI Chat API...");
const llm = new ChatOpenAI({
    temperature: 0.1,
    modelName: "gpt-3.5-turbo-1106",
    //modelName: "gpt-4-0125-preview", 
    openAIApiKey: openAIApiKey, 
});



// Setup data loading (load a PDF)
console.log("Loading PDF...");
const loader = new PDFLoader(
  "./data/MachineLearning-Lecture01.pdf"
);




// Setup the document splitter
const rawCS229Docs = await loader.load();
const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1536,
    chunkOverlap: 128
});
const splitDocs = await splitter.splitDocuments(rawCS229Docs);



// Initialize VectorStore
console.log("Initializing VectorStore...");
// Use OpenAI Embeddings API
const embeddings = new OpenAIEmbeddings({openAIApiKey: openAIApiKey});
const vectorstore = new MemoryVectorStore(embeddings);
await vectorstore.addDocuments(splitDocs);

// Create a Retriever from the VectorStore
const retriever = vectorstore.asRetriever();



/// Setup document retrieval chain
console.log("Setting up document retrieval chain...");
const convertDocsToString = (documents) => {
    return documents.map((document) => `<doc>\n${document.pageContent}\n</doc>`).join("\n");
  };
  
  const documentRetrievalChain = RunnableSequence.from([
    (input) => input.standalone_question,
    retriever,
    convertDocsToString,
  ]);



/// Adding history and support for rephrasing question
console.log("Adding history support...");
const REPHRASE_QUESTION_SYSTEM_TEMPLATE = 
`Given the following conversation and a follow up question, 
rephrase the follow up question to be a standalone question.`;

const rephraseQuestionChainPrompt = ChatPromptTemplate.fromMessages([
  ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("history"),
  [
    "human", 
    "Rephrase the following question as a standalone question:\n{question}"
  ],
]);

const rephraseQuestionChain = RunnableSequence.from([
    rephraseQuestionChainPrompt,
    llm,
    new StringOutputParser(),
]);


/// Anwser generation chain
const ANSWER_CHAIN_SYSTEM_TEMPLATE = `You are an experienced researcher,
expert at interpreting and answering questions based on provided sources.
Using the below provided context and chat history, 
answer the user's question to the best of your ability
using only the resources provided. Be verbose!

<context>
{context}
</context>`;

const answerGenerationChainPrompt = ChatPromptTemplate.fromMessages([
  ["system", ANSWER_CHAIN_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("history"),
  [
    "human", 
    `Now, answer this question using the previous context and chat history:
  
    {standalone_question}`
  ]
]);


/// Conversational retrieval chain
const messageHistories = {};

const getMessageHistoryForSession = (sessionId) => {
  if (messageHistories[sessionId] !== undefined) {
    return messageHistories[sessionId];
  } 
  const newChatSessionHistory = new ChatMessageHistory();
  messageHistories[sessionId] = newChatSessionHistory;
  return newChatSessionHistory;
};

const conversationalRetrievalChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      standalone_question: rephraseQuestionChain,
    }),
    RunnablePassthrough.assign({
      context: documentRetrievalChain,
    }),
    answerGenerationChainPrompt,
    llm,
  ]);



// TODO: As an additional challenge - see if you can implement a streamed response
//   // "text/event-stream" is also supported
// const httpResponseOutputParser = new HttpResponseOutputParser({
//     contentType: "text/plain"
//   });

// Streamed version - 
// const finalRetrievalChain = new RunnableWithMessageHistory({
//     runnable: conversationalRetrievalChain,
//     getMessageHistory: getMessageHistoryForSession,
//     inputMessagesKey: "question",
//     historyMessagesKey: "history",
// }).pipe(httpResponseOutputParser);


// String output version
const finalRetrievalChain = new RunnableWithMessageHistory({
    runnable: conversationalRetrievalChain,
    getMessageHistory: getMessageHistoryForSession,
    inputMessagesKey: "question",
    historyMessagesKey: "history",
}).pipe(new StringOutputParser());

  

 /// Setup server

 const port = 8087;

//  const handler = async (request) => {
//     const pathname = new URL(request.url).pathname;
    
//     if (pathname === "/question") {
//         const requestBody = await request.json();
//         console.log("Received question: " + requestBody.question + " with session id: " + requestBody.session_id);

//         // const response = await finalRetrievalChain.stream({
//         //     question: requestBody.question
//         // }, { configurable: { sessionId: requestBody.session_id } });
//         const response = await finalRetrievalChain.invoke({
//             question: requestBody.question
//         }, { configurable: { sessionId: requestBody.session_id } });
    
//         const responseObj = JSON.stringify({
//             answer: response
//         });
//         console.log("Sending response..." + responseObj);

//         return new Response(responseObj, { 
//         status: 200,
//         headers: {
//             "Content-Type": "text/plain"
//         },
//         });
//     } else if (pathname === "/") {
//         return serveFile(request, "./index.html");
//     }
  // };


// Create a Node.js express server handler and start the server
const express = require('express');
const app = express();
app.use(express.json());
app.post('/question', async (req, res) => {
  const requestBody = await req.json();
  console.log("Received question: " + requestBody.question + " with session id: " + requestBody.session_id);

  // const response = await finalRetrievalChain.stream({
  //     question: requestBody.question
  // }, { configurable: { sessionId: requestBody.session_id } });
  const response = await finalRetrievalChain.invoke({
      question: requestBody.question
  }, { configurable: { sessionId: requestBody.session_id } });

  const responseObj = JSON.stringify({
      answer: response
  });
  console.log("Sending response..." + responseObj);

  res.send(Response(responseObj, { 
  status: 200,
  headers: {
      "Content-Type": "text/plain"
  },
 }));
});
app.get('/', async (req, res) => {
    // Serve a static file
    res.sendFile('index.html', { root: __dirname });
});
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
