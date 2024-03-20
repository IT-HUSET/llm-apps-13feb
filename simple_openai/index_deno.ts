// Start using:
// deno run --allow-net --allow-read --allow-env index_deno.ts

import OpenAI from "https://deno.land/x/openai@v4.27.1/mod.ts";
import { Anthropic } from "npm:@anthropic-ai/sdk";

//const openAIApiKey = '' // Define the OpenAI API key here

const openai = new OpenAI({apiKey: Deno.env.get("OPENAI_API_KEY")});

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"), // defaults to process.env["ANTHROPIC_API_KEY"]
});

async function chat(input: string) {
  /// Use eithcer OpenAI
  const response: OpenAI.Chat.ChatCompletion = await openai.chat.completions.create({
  messages: [{ role: 'user', content: input}],
  //model: 'gpt-3.5-turbo',
  model: 'gpt-4-0125-preview',
  temperature: 1.0,
  });

  /// ... or Claude (Ahthropic)
  // const response:any = await anthropic.beta.messages.create({
    //   //model: "claude-3-opus-20240229",
    //   model: "claude-3-sonnet-20240229", 
  // max_tokens: 1000,
  // temperature: 1.0,
  // system: "A helpful assistant.",
  // messages: [
  //   {
  //     "role": "user",
  //     "content": [
  //       {
  //         "type": "text",
  //         "text": input
  //       }
  //     ]
  //   }
  // ]
  // });

  //console.log(response);
  return response.choices[0].message.content;
}

async function chatClaude(input: string) {
  const response:any = await anthropic.beta.messages.create({
    //model: "claude-3-opus-20240229",
    model: "claude-3-sonnet-20240229", 
  max_tokens: 1000,
  temperature: 0,
  system: "A helpful assistant.",
  messages: [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": input
        }
      ]
    }
  ]
  });
  //console.log(response);
  return response.content[0].text;
}

const question = "What is the capital of France";

await chat(question)
  .then((response) => console.log(response))
  .catch((error) => console.error(error));

const promptTemplate = `
  Be very funny when answering questions
  Question: {question}
  `;

const prompt = promptTemplate.replace("{question}", question);

await chat(prompt)
  .then((response) => console.log(response))
  .catch((error) => console.error(error));
