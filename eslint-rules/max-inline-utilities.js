// Our own ESLint check: a className may list at most a few classes inline (6 by default). A longer
// list is hard to read in one line, so it goes in a `styles` object, grouped by what each part does,
// and is passed to cn(). Classes written straight inside cn('...') count too, so cn() can't hide them.
// Names like `styles.navLink` are not counted: that's where the long lists are meant to live.

/** How many classes a piece of text holds, split on spaces and new lines. */
const countClasses = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * The class lists written out in `node`, each as plain text. A template's `${...}` parts are left out, so
 * `px-${size}` still counts as one class.
 */
function classTexts(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return [node.value];
  }
  if (node.type === 'TemplateLiteral') {
    return [node.quasis.map((quasi) => quasi.value.cooked ?? '').join('')];
  }
  // `cond ? 'a b' : 'c d'`: each side is counted on its own.
  if (node.type === 'ConditionalExpression') {
    return [...classTexts(node.consequent), ...classTexts(node.alternate)];
  }
  // `on && 'a b'` or `name || 'a b'`: the classes are on the right.
  if (node.type === 'LogicalExpression') {
    return classTexts(node.right);
  }
  return [];
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Limit how many classes a className lists inline' },
    schema: [{ type: 'integer', minimum: 1 }],
    messages: {
      tooMany: 'More than {{max}} classes inline (found {{count}}): move them into a styles object and use cn().',
    },
  },
  create(context) {
    const max = context.options[0] ?? 6;

    function check(node) {
      for (const text of classTexts(node)) {
        const count = countClasses(text);
        if (count > max) {
          context.report({ node, messageId: 'tooMany', data: { max, count } });
        }
      }
    }

    return {
      JSXAttribute(attribute) {
        if (attribute.name.name !== 'className' || !attribute.value) {
          return;
        }
        const value = attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value;
        check(value);
        // cn('a b c', ...): look at what is passed straight into the call, one level deep.
        if (value.type === 'CallExpression') {
          value.arguments.forEach(check);
        }
      },
    };
  },
};
