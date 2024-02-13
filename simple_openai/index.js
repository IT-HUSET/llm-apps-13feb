
import { OpenAI } from "openai";

const openAIApiKey = ...; // Define the OpenAI API key here

const openai = new OpenAI({apiKey: openAIApiKey});

async function chat(input) {
  const response = await openai.chat.completions.create({
    messages: [{ role: 'user', content: input}],
    model: 'gpt-3.5-turbo',
    temperature: 0.1,
  });

  return response.choices[0].message.content;
}

const question = "What is the capital of France";

chat(question)
  .then((response) => console.log(response))
  .catch((error) => console.error(error));

const promptTemplate = `
  Be very funny when answering questions
  Question: {question}
  `;

const prompt = promptTemplate.replace("{question}", question);

chat(prompt)
  .then((response) => console.log(response))
  .catch((error) => console.error(error));
