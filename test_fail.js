import { renderMarkdown } from './js/editor.js';

const existingPages = new Map([
  ['Guides/Style Guide', { name: 'Guides/Style Guide', exists: true }],
  ['Tutorial', { name: 'Tutorial', exists: false }],
  ['Welcome', { name: 'Welcome', exists: true }]
]);

console.log(renderMarkdown('[[Style Guide]]', existingPages));
console.log(renderMarkdown('[[Tutorial]]', existingPages));
console.log(renderMarkdown('[[Create Me]]', existingPages));
console.log(renderMarkdown('[[Guides/Style Guide]]', existingPages));
