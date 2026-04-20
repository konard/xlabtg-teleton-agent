// Verify if assertSafePath in current code blocks all vectors
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
function current(parts) {
  if (parts.some((p) => FORBIDDEN_SEGMENTS.has(p))) throw new Error("blocked");
}

// 1. Case variant — JS property lookups are case sensitive, so "__PROTO__" doesn't access prototype.
try { current("__PROTO__".split(".")); console.log("1 __PROTO__ passes (harmless)"); } catch (e) { console.log("1 __PROTO__ blocked"); }

// 2. Can "foo.__proto__" be bypassed somehow? Splitting "foo.__proto__" → ["foo", "__proto__"] → blocked. Good.
try { current("foo.__proto__".split(".")); console.log("2 foo.__proto__ NOT blocked"); } catch (e) { console.log("2 foo.__proto__ blocked"); }

// 3. Object.hasOwn behavior on safe path
const obj = {};
console.log("3 obj.hasOwnProperty exists as inherited:", typeof obj.hasOwnProperty);
console.log("3 Object.hasOwn(obj, 'hasOwnProperty'):", Object.hasOwn(obj, "hasOwnProperty"));

// 4. getNestedValue returns inherited property?
function getNestedValue(o, path) {
  const parts = path.split(".");
  current(parts);
  let c = o;
  for (const p of parts) { if (c == null || typeof c !== "object") return undefined; c = c[p]; }
  return c;
}
console.log("4 get inherited toString:", typeof getNestedValue({}, "toString"));

// 5. What about setNestedValue polluting through crafted key if FORBIDDEN is bypassed?
// If attacker could inject "__proto__" - blocked. If attacker injects "a" then "__proto__"? Same—check parts.
