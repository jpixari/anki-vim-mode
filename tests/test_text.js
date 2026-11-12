// Run with: node tests/test_text.js
const T = require("../vim_text.js");
const assert = require("assert");

let passed = 0;

function eq(actual, expected, label) {
    assert.deepStrictEqual(actual, expected, label);
    passed++;
}

// lines
const L = "one two\n\nthree, four\nlast";
eq(T.lineStart(L, 3), 0, "lineStart");
eq(T.lineEnd(L, 3), 7, "lineEnd");
eq(T.lineStart(L, 8), 8, "empty line start");
eq(T.lineEnd(L, 8), 8, "empty line end");
eq(T.lineLast(L, 8), 8, "empty line last");
eq(T.lineLast(L, 0), 6, "lineLast");
eq(T.lineIndex(L, 9), 2, "lineIndex");
eq(T.lineCount(L), 4, "lineCount");
eq(T.lineCount(""), 1, "lineCount empty");
eq(T.lineStartOf(L, 3), 21, "lineStartOf");
eq(T.clampNormal(L, 7), 6, "clamp off newline");
eq(T.firstNonBlank("  ab", 3), 2, "firstNonBlank");
eq(T.moveLines(L, 5, 1, 5), 8, "j onto empty line");
eq(T.moveLines(L, 8, 1, 5), 14, "j keeps column");
eq(T.moveLines(L, 0, 99, 0), 21, "j clamps");
eq(T.moveLines(L, 21, -99, Infinity), 6, "k with $ column");

// w
eq(T.wordForward("foo bar", 0), 4, "w");
eq(T.wordForward("foo.bar", 0), 3, "w punct");
eq(T.wordForward("foo.bar", 0, true), 7, "W");
eq(T.wordForward(L, 4), 8, "w stops on empty line");
eq(T.wordForward(L, 8), 9, "w from empty line");
eq(T.wordForward("a  \n  b", 0), 6, "w skips blanks across lines");
eq(T.wordForward("end", 0), 3, "w at last word");

// e
eq(T.wordEnd("foo bar", 0), 2, "e");
eq(T.wordEnd("foo bar", 2), 6, "e next");
eq(T.wordEnd("foo.bar", 0), 2, "e punct");
eq(T.wordEnd("a\n\nbc", 0), 4, "e over empty line");

// b
eq(T.wordBack("foo bar", 4), 0, "b");
eq(T.wordBack("foo bar", 6), 4, "b inside");
eq(T.wordBack("foo.bar", 4), 3, "b punct");
eq(T.wordBack(L, 9), 8, "b stops on empty line");
eq(T.wordBack("abc", 0), 0, "b at start");

// ge
eq(T.wordEndBack("foo bar", 5), 2, "ge");
eq(T.wordEndBack("foo bar", 4), 2, "ge at word start");

// f t
eq(T.findChar("a,b,c", 0, ",", "f", 1), 1, "f");
eq(T.findChar("a,b,c", 0, ",", "f", 2), 3, "2f");
eq(T.findChar("a,b,c", 0, ",", "t", 1), 0, "t adjacent");
eq(T.findChar("a,b,c", 0, ",", "t", 1, true), 2, "; after t skips");
eq(T.findChar("a,b,c", 4, ",", "F", 1), 3, "F");
eq(T.findChar("a,b,c", 4, ",", "T", 1), 4, "T adjacent");
eq(T.findChar("a,b\n,c", 0, ",", "f", 2), -1, "f stays on line");
eq(T.findChar("abc", 0, "z", "f", 1), -1, "f miss");

// %
eq(T.matchPair("a (b [c] d) e", 0), 10, "% forward");
eq(T.matchPair("a (b [c] d) e", 10), 2, "% backward");
eq(T.matchPair("abc", 0), -1, "% none");

// paragraphs
eq(T.paragraphForward("a\nb\n\nc", 0), 4, "}");
eq(T.paragraphForward("a\nb", 0), 3, "} to end");
eq(T.paragraphBack("a\n\nb\nc", 5), 2, "{");
eq(T.paragraphBack("a\nb", 2), 0, "{ to start");

// text objects
eq(T.wordObject("foo bar baz", 5, false), { start: 4, end: 7 }, "iw");
eq(T.wordObject("foo bar baz", 5, true), { start: 4, end: 8 }, "aw");
eq(T.wordObject("foo bar", 5, true), { start: 3, end: 7 }, "aw at end");
eq(T.wordObject("foo  bar", 3, false), { start: 3, end: 5 }, "iw on space");
eq(T.wordObject("a\n\nb", 2, false), { start: 2, end: 2 }, "iw empty line");
eq(T.wordObject("foo.bar", 1, false, true), { start: 0, end: 7 }, "iW");
eq(T.quoteObject('say "hi there" ok', 6, '"', false), { start: 5, end: 13 }, 'i"');
eq(T.quoteObject('say "hi there" ok', 6, '"', true), { start: 4, end: 15 }, 'a"');
eq(T.quoteObject('say "hi" ok', 0, '"', false), { start: 5, end: 7 }, 'i" ahead');
eq(T.quoteObject("none", 0, '"', false), null, 'i" none');
eq(T.pairObject("f(a, (b), c)", 3, "(", ")", false), { start: 2, end: 11 }, "i(");
eq(T.pairObject("f(a, (b), c)", 6, "(", ")", true), { start: 5, end: 8 }, "a( nested");
eq(T.pairObject("x = (1)", 0, "(", ")", false), { start: 5, end: 6 }, "i( ahead");
eq(T.pairObject("f(a", 2, "(", ")", false), null, "i( unbalanced");

const C = "The {{c1::capital::city}} of {{c2::France}}";
eq(T.clozeObject(C, 12, false), { start: 10, end: 17 }, "inner cloze w/ hint");
eq(T.clozeObject(C, 12, true), { start: 4, end: 25 }, "around cloze");
eq(T.clozeObject(C, 35, false), { start: 35, end: 41 }, "inner cloze 2");
eq(T.clozeObject(C, 0, false), { start: 10, end: 17 }, "cloze ahead");
eq(T.clozeObject(C, 27, false), { start: 35, end: 41 }, "between clozes -> next");
eq(T.clozeObject("plain", 2, false), null, "no cloze");

eq(T.paragraphObject("a\nb\n\nc", 0, false), { start: 0, end: 3 }, "ip");
eq(T.paragraphObject("a\nb\n\nc", 0, true), { start: 0, end: 4 }, "ap");

// sentences
const S = "One two. Three four! Five?\n\nNew para. End";
eq(T.sentenceForward(S, 0), 9, ") next sentence");
eq(T.sentenceForward(S, 9), 21, ") again");
eq(T.sentenceForward(S, 21), 27, ") stops on the empty line");
eq(T.sentenceForward(S, 27), 28, ") into next paragraph");
eq(T.sentenceBack(S, 12), 9, "( to sentence start");
eq(T.sentenceBack(S, 9), 0, "( previous");
eq(T.sentenceObject(S, 11, false), { start: 9, end: 20 }, "is");
eq(T.sentenceObject(S, 11, true), { start: 9, end: 21 }, "as");
eq(T.sentenceObject("Just one", 3, false), { start: 0, end: 8 }, "is single");
eq(T.numberAt("x 12 y -7", 0), { start: 2, end: 4 }, "number ahead");
eq(T.numberAt("x 12 y -7", 3), { start: 2, end: 4 }, "number under cursor");
eq(T.numberAt("x 12 y -7", 4), { start: 7, end: 9 }, "next number, negative");
eq(T.numberAt("none", 0), null, "no number");

// search
eq(T.search("foo bar foo", "foo", 0, true, 1), 8, "/ forward");
eq(T.search("foo bar foo", "foo", 8, true, 1), 0, "/ wraps");
eq(T.search("foo bar foo", "foo", 8, false, 1), 0, "? backward");
eq(T.search("Foo foo", "foo", 0, true, 1), 4, "smartcase off -> ignore case");
eq(T.search("Foo foo x Foo", "Foo", 0, true, 1), 10, "smartcase on");
eq(T.search("abc", "zzz", 0, true, 1), -1, "search miss");
eq(T.search("a(b", "(", 0, true, 1), 1, "invalid regex falls back to literal");
eq(T.toggleCase("aBc1"), "AbC1", "toggleCase");

console.log("vim_text: " + passed + " assertions passed");
