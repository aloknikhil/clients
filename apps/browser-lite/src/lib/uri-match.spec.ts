import { registrableDomain, UriMatch, uriMatches } from "./uri-match";

describe("registrableDomain", () => {
  it.each([
    ["https://login.example.co.uk/path", "example.co.uk"],
    ["example.com", "example.com"],
    ["http://localhost:8080", "localhost"],
    ["https://192.168.1.10/login", "192.168.1.10"],
    // Private suffixes: each GitHub Pages site is its own registrable domain.
    ["https://alice.github.io", "alice.github.io"],
  ])("%s -> %s", (uri, expected) => {
    expect(registrableDomain(uri)).toBe(expected);
  });

  it.each(["", "about:blank", "data:text/html,hi", "javascript:alert(1)", "file:///etc/passwd"])(
    "returns undefined for %p",
    (uri) => {
      expect(registrableDomain(uri)).toBeUndefined();
    },
  );
});

describe("uriMatches", () => {
  describe("Domain (default)", () => {
    it("matches subdomains of the same registrable domain", () => {
      expect(
        uriMatches("https://example.com", undefined, "https://accounts.example.com/login"),
      ).toBe(true);
    });

    it("does not match a different domain that merely ends with the saved one", () => {
      expect(uriMatches("example.com", undefined, "https://evil-example.com")).toBe(false);
      expect(uriMatches("example.com", undefined, "https://example.com.evil.net")).toBe(false);
    });

    it("does not let one github.io site match another", () => {
      expect(
        uriMatches("https://alice.github.io", UriMatch.Domain, "https://mallory.github.io"),
      ).toBe(false);
    });

    it("never matches blocklisted hosts on a shared domain", () => {
      expect(
        uriMatches("https://accounts.google.com", undefined, "https://script.google.com/macros"),
      ).toBe(false);
      expect(uriMatches("https://accounts.google.com", undefined, "https://mail.google.com")).toBe(
        true,
      );
    });

    it("matches punycode and unicode forms of the same domain", () => {
      expect(uriMatches("https://bücher.de", undefined, "https://xn--bcher-kva.de/login")).toBe(
        true,
      );
    });
  });

  it("Host requires the exact host including port", () => {
    expect(
      uriMatches("https://example.com:8443", UriMatch.Host, "https://example.com:8443/x"),
    ).toBe(true);
    expect(uriMatches("https://example.com:8443", UriMatch.Host, "https://example.com/x")).toBe(
      false,
    );
    expect(uriMatches("https://example.com", UriMatch.Host, "https://www.example.com")).toBe(false);
  });

  it("StartsWith and Exact compare the raw URL", () => {
    expect(
      uriMatches("https://example.com/app", UriMatch.StartsWith, "https://example.com/app/login"),
    ).toBe(true);
    expect(
      uriMatches("https://example.com/app", UriMatch.StartsWith, "https://example.com/other"),
    ).toBe(false);
    expect(uriMatches("https://example.com/a", UriMatch.Exact, "https://example.com/a")).toBe(true);
    expect(uriMatches("https://example.com/a", UriMatch.Exact, "https://example.com/a?x")).toBe(
      false,
    );
  });

  it("RegularExpression matches case-insensitively and tolerates invalid patterns", () => {
    expect(
      uriMatches(
        "^https://.*\\.EXAMPLE\\.com/",
        UriMatch.RegularExpression,
        "https://a.example.com/",
      ),
    ).toBe(true);
    expect(uriMatches("([", UriMatch.RegularExpression, "https://example.com")).toBe(false);
  });

  it("Never and empty values never match", () => {
    expect(uriMatches("https://example.com", UriMatch.Never, "https://example.com")).toBe(false);
    expect(uriMatches(undefined, undefined, "https://example.com")).toBe(false);
    expect(uriMatches("https://example.com", undefined, "")).toBe(false);
  });
});
