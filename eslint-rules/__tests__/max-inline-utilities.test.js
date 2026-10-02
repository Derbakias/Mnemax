import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import rule from '../max-inline-utilities.js';

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const six = 'a b c d e f';
const seven = 'a b c d e f g';
const error = (count) => ({
  message: `More than 6 classes inline (found ${count}): move them into a styles object and use cn().`,
});

tester.run('max-inline-utilities', rule, {
  valid: [
    `<div className="${six}" />`,
    `<div className={'${six}'} />`,
    '<div className={styles.navLink} />',
    "<div className={cn(styles.a, active && 'x')} />",
    '<div className="" />',
    '<div className={``} />',
    // `px-${size}` is one class, whatever size is.
    '<div className={`a b c d e px-${size}`} />',
    `<div className="  a  b\n  c d\n\n e   f  " />`,
    // Only className is checked.
    `<div title="${seven}" />`,
    // Things deeper than one call are left alone.
    `<div className={cn(['${seven}'])} />`,
  ],
  invalid: [
    { code: `<div className="${seven}" />`, errors: [error(7)] },
    { code: `<div className={'${seven}'} />`, errors: [error(7)] },
    { code: '<div className={`a b c ${x} d e f g`} />', errors: [error(7)] },
    { code: `<div className={cn('${seven}', x)} />`, errors: [error(7)] },
    { code: `<div className={on ? 'a b' : '${seven} h'} />`, errors: [error(8)] },
    { code: `<div className={cn(on ? '${seven}' : 'a')} />`, errors: [error(7)] },
    { code: `<div className={on && '${seven}'} />`, errors: [error(7)] },
    { code: `<div className={cn(styles.a, active && '${seven}')} />`, errors: [error(7)] },
    { code: `<div className={cn(name || '${seven}')} />`, errors: [error(7)] },
  ],
});
