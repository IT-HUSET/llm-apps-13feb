// Run with:
// deno run --allow-net --allow-read --allow-env index.ts

import { serveDir, serveFile } from "https://deno.land/std@0.207.0/http/file_server.ts";

import { ChatOpenAI } from "npm:@langchain/openai";
import { HumanMessage, AIMessage } from "npm:@langchain/core/messages";
import { ChatPromptTemplate, 
    SystemMessagePromptTemplate, 
    HumanMessagePromptTemplate  } from "npm:@langchain/core/prompts";
import { StringOutputParser } from "npm:@langchain/core/output_parsers";
import { RunnableSequence } from "npm:@langchain/core/runnables";
import { HttpResponseOutputParser } from "npm:langchain/output_parsers";

import { OpenAIEmbeddings } from "npm:@langchain/openai";
import { similarity } from "npm:ml-distance";
import { MemoryVectorStore } from "npm:langchain/vectorstores/memory";

import * as parse from "npm:pdf-parse";
import { PDFLoader } from "npm:langchain/document_loaders/fs/pdf";
import { 
    RecursiveCharacterTextSplitter
} from "npm:langchain/text_splitter";

import { Document } from "npm:@langchain/core/documents";

import { RunnableMap, RunnablePassthrough } from "npm:@langchain/core/runnables";
import { MessagesPlaceholder } from "npm:@langchain/core/prompts";

import { RunnableWithMessageHistory } from "npm:@langchain/core/runnables";
import { ChatMessageHistory } from "npm:langchain/stores/message/in_memory";

import { Client } from "npm:langsmith";
import { LangChainTracer } from "npm:langchain/callbacks";


const openAIApiKey = "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"; 



/// Setup LangSmith - Uncomment and add your own API key, or use the existing and ask Tobias to show you 😃
// Deno.env.set("LANGCHAIN_TRACING_V2", "true");
// Deno.env.set("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com");
// Deno.env.set("LANGCHAIN_API_KEY", "ls__fa328f2db9e64ba59c4740b3b76237fc");
// Deno.env.set("LANGCHAIN_PROJECT", "lab1");

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
const convertDocsToString = (documents: Document[]): string => {
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
const messageHistories: Record<string, ChatMessageHistory> = {};

const getMessageHistoryForSession = (sessionId: string) => {
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

 const handler = async (request: Request): Response => {
    const pathname = new URL(request.url).pathname;
    
    if (pathname === "/question") {
        const requestBody = await request.json();
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

        return new Response(responseObj, { 
        status: 200,
        headers: {
            "Content-Type": "text/plain"
        },
        });
    } else if (pathname === "/") {
        return serveFile(request, "./index.html");
    }
  };


Deno.serve({ port }, handler);
