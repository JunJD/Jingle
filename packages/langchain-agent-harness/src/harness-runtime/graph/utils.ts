
import { isBaseChatModel, isConfigurableModel } from "./model.js"
import { MultipleToolsBoundError } from "./errors.js"
import { AIMessage, AIMessageChunk, SystemMessage } from "@langchain/core/messages"
import { Runnable, RunnableBinding, RunnableSequence } from "@langchain/core/runnables"
const NAME_PATTERN = /<name>(.*?)<\/name>/s;
const CONTENT_PATTERN = /<content>(.*?)<\/content>/s;
/**
* Attach formatted agent names to the messages passed to and from a language model.
*
* This is useful for making a message history with multiple agents more coherent.
*
* NOTE: agent name is consumed from the message.name field.
* If you're using an agent built with createAgent, name is automatically set.
* If you're building a custom agent, make sure to set the name on the AI message returned by the LLM.
*
* @param message - Message to add agent name formatting to
* @returns Message with agent name formatting
*
* @internal
*/
function _addInlineAgentName(message: any) {
	if (!AIMessage.isInstance(message) || AIMessageChunk.isInstance(message)) return message;
	if (!message.name) return message;
	const { name } = message;
	if (typeof message.content === "string") return new AIMessage({
		...message.lc_kwargs,
		content: `<name>${name}</name><content>${message.content}</content>`,
		name: void 0
	});
		const updatedContent: any[] = [];
	let textBlockCount = 0;
	for (const contentBlock of message.content) if (typeof contentBlock === "string") {
		textBlockCount += 1;
		updatedContent.push(`<name>${name}</name><content>${contentBlock}</content>`);
	} else if (typeof contentBlock === "object" && "type" in contentBlock && contentBlock.type === "text") {
		textBlockCount += 1;
		updatedContent.push({
			...contentBlock,
			text: `<name>${name}</name><content>${contentBlock.text}</content>`
		});
	} else updatedContent.push(contentBlock);
	if (!textBlockCount) updatedContent.unshift({
		type: "text",
		text: `<name>${name}</name><content></content>`
	});
	return new AIMessage({
		...message.lc_kwargs,
		content: updatedContent,
		name: void 0
	});
}
/**
* Remove explicit name and content XML tags from the AI message content.
*
* Examples:
*
* @example
* ```typescript
* removeInlineAgentName(new AIMessage({ content: "<name>assistant</name><content>Hello</content>", name: "assistant" }))
* // AIMessage with content: "Hello"
*
* removeInlineAgentName(new AIMessage({ content: [{type: "text", text: "<name>assistant</name><content>Hello</content>"}], name: "assistant" }))
* // AIMessage with content: [{type: "text", text: "Hello"}]
* ```
*
* @internal
*/
function _removeInlineAgentName(message: any) {
	if (!AIMessage.isInstance(message) || !message.content) return message;
	let updatedContent: any[] | string = [];
	let updatedName: string | undefined;
	if (Array.isArray(message.content)) updatedContent = message.content.filter((block) => {
		if (block.type === "text" && typeof block.text === "string") {
			const nameMatch = block.text.match(NAME_PATTERN);
			const contentMatch = block.text.match(CONTENT_PATTERN);
			if (nameMatch && (!contentMatch || contentMatch[1] === "")) {
				updatedName = nameMatch[1];
				return false;
			}
			return true;
		}
		return true;
	}).map((block) => {
		if (block.type === "text" && typeof block.text === "string") {
			const nameMatch = block.text.match(NAME_PATTERN);
			const contentMatch = block.text.match(CONTENT_PATTERN);
			if (!nameMatch || !contentMatch) return block;
			updatedName = nameMatch[1];
			return {
				...block,
				text: contentMatch[1]
			};
		}
		return block;
	});
	else {
		const content = message.content;
		const nameMatch = content.match(NAME_PATTERN);
		const contentMatch = content.match(CONTENT_PATTERN);
		if (!nameMatch || !contentMatch) return message;
		updatedName = nameMatch[1];
		updatedContent = contentMatch[1];
	}
	return new AIMessage({
		...Object.keys(message.lc_kwargs ?? {}).length > 0 ? message.lc_kwargs : message,
		content: updatedContent,
		name: updatedName
	});
}
function isClientTool(tool: any) {
	return Runnable.isRunnable(tool);
}
/**
* Helper function to check if a language model has a bindTools method.
* @param llm - The language model to check if it has a bindTools method.
* @returns True if the language model has a bindTools method, false otherwise.
*/
function _isChatModelWithBindTools(llm: any) {
	if (!isBaseChatModel(llm)) return false;
	return "bindTools" in llm && typeof llm.bindTools === "function";
}
/**
* Helper function to bind tools to a language model.
* @param llm - The language model to bind tools to.
* @param toolClasses - The tools to bind to the language model.
* @param options - The options to pass to the language model.
* @returns The language model with the tools bound to it.
*/
const _simpleBindTools = (llm: any, toolClasses: any[], options: Record<string, unknown> = {}) => {
	if (_isChatModelWithBindTools(llm)) return llm.bindTools(toolClasses, options);
		if (RunnableBinding.isRunnableBinding(llm) && _isChatModelWithBindTools(llm.bound)) {
			const newBound = (llm.bound as any).bindTools(toolClasses, options);
		if (RunnableBinding.isRunnableBinding(newBound)) return new RunnableBinding({
			bound: newBound.bound,
			config: {
				...llm.config,
				...newBound.config
			},
			kwargs: {
				...llm.kwargs,
				...newBound.kwargs
			},
			configFactories: newBound.configFactories ?? llm.configFactories
		});
		return new RunnableBinding({
			bound: newBound,
			config: llm.config,
			kwargs: llm.kwargs,
			configFactories: llm.configFactories
		});
	}
	return null;
};
/**
* Check if the LLM already has bound tools and throw if it does.
*
* @param llm - The LLM to check.
* @returns void
*/
function validateLLMHasNoBoundTools(llm: any) {
	/**
	* If llm is a function, we can't validate until runtime, so skip
	*/
	if (typeof llm === "function") return;
	let model = llm;
	/**
	* If model is a RunnableSequence, find a RunnableBinding in its steps
	*/
	if (RunnableSequence.isRunnableSequence(model)) model = model.steps.find((step) => RunnableBinding.isRunnableBinding(step)) || model;
	/**
	* If model is configurable, get the underlying model
	*/
	if (isConfigurableModel(model))
 /**
	* Can't validate async model retrieval in constructor
	*/
	return;
	/**
	* Check if model is a RunnableBinding with bound tools
	*/
	if (RunnableBinding.isRunnableBinding(model)) {
		const hasToolsInKwargs = model.kwargs != null && typeof model.kwargs === "object" && "tools" in model.kwargs && Array.isArray(model.kwargs.tools) && model.kwargs.tools.length > 0;
		const hasToolsInConfig = model.config != null && typeof model.config === "object" && "tools" in model.config && Array.isArray(model.config.tools) && model.config.tools.length > 0;
		if (hasToolsInKwargs || hasToolsInConfig) throw new MultipleToolsBoundError();
	}
	/**
	* Also check if model has tools property directly (e.g., FakeToolCallingModel)
	*/
	if ("tools" in model && model.tools !== void 0 && Array.isArray(model.tools) && model.tools.length > 0) throw new MultipleToolsBoundError();
}
/**
* Check if the last message in the messages array has tool calls.
*
* @param messages - The messages to check.
* @returns True if the last message has tool calls, false otherwise.
*/
function hasToolCalls(message: any) {
	return Boolean(AIMessage.isInstance(message) && message.tool_calls && message.tool_calls.length > 0);
}
/**
* Normalizes a system prompt to a SystemMessage object.
* If it's already a SystemMessage, returns it as-is.
* If it's a string, converts it to a SystemMessage.
* If it's undefined, creates an empty system message so it is easier to append to it later.
*/
function normalizeSystemPrompt(systemPrompt: any) {
	if (systemPrompt == null) return new SystemMessage("");
	if (SystemMessage.isInstance(systemPrompt)) return systemPrompt;
	if (typeof systemPrompt === "string") return new SystemMessage({ content: [{
		type: "text",
		text: systemPrompt
	}] });
	throw new Error(`Invalid systemPrompt type: expected string or SystemMessage, got ${typeof systemPrompt}`);
}
/**
* Helper function to bind tools to a language model.
* @param llm - The language model to bind tools to.
* @param toolClasses - The tools to bind to the language model.
* @param options - The options to pass to the language model.
* @returns The language model with the tools bound to it.
*/
async function bindTools(llm: any, toolClasses: any[], options: Record<string, unknown> = {}) {
	const model = _simpleBindTools(llm, toolClasses, options);
	if (model) return model;
	if (isConfigurableModel(llm)) {
		const model = _simpleBindTools(await llm._getModelInstance(), toolClasses, options);
		if (model) return model;
	}
	if (RunnableSequence.isRunnableSequence(llm)) {
		const modelStep = llm.steps.findIndex((step) => RunnableBinding.isRunnableBinding(step) || isBaseChatModel(step) || isConfigurableModel(step));
		if (modelStep >= 0) {
			const model = _simpleBindTools(llm.steps[modelStep], toolClasses, options);
			if (model) {
				const nextSteps = llm.steps.slice();
				nextSteps.splice(modelStep, 1, model);
					return RunnableSequence.from(nextSteps as any);
			}
		}
	}
	throw new Error(`llm ${llm} must define bindTools method.`);
}
export { _addInlineAgentName, _removeInlineAgentName, bindTools, hasToolCalls, isClientTool, normalizeSystemPrompt, validateLLMHasNoBoundTools };
