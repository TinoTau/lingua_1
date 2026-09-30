from pathlib import Path

p = Path(
    "electron_node/electron-node/main/src/model2-runtime/model2-runtime-final-closure.e2e.test.ts"
)
t = p.read_text(encoding="utf-8")
replacements = [
    (
        """      fuzzyRecallEnabled: false,
    });
    const base = hitsToBaseCandidates(c, baseRecall.hits);""",
        """      fuzzyRecallEnabled: false,
      acousticTonePattern: c.observedTonePattern,
    });
    const base = hitsToBaseCandidates(c, baseRecall.hits);""",
    ),
    (
        """        fuzzyRecallEnabled: false,
      });
      const base = hitsToBaseCandidates(c, baseRecall.hits);""",
        """        fuzzyRecallEnabled: false,
        acousticTonePattern: c.observedTonePattern,
      });
      const base = hitsToBaseCandidates(c, baseRecall.hits);""",
    ),
    (
        """        domainIds: c.domainScope,
      });
""",
        """        domainIds: c.domainScope,
        acousticTonePattern: c.observedTonePattern,
      });
""",
    ),
    (
        """      domainIds: c.domainScope,
    });
""",
        """      domainIds: c.domainScope,
      acousticTonePattern: c.observedTonePattern,
    });
""",
    ),
    (
        """      domainIds: c.domainScope,
      forceInferenceFail: true,
    });
""",
        """      domainIds: c.domainScope,
      acousticTonePattern: c.observedTonePattern,
      forceInferenceFail: true,
    });
""",
    ),
]
for a, b in replacements:
    if a not in t:
        print("MISSING pattern")
    else:
        t = t.replace(a, b)
        print("replaced once-ish", t.count("acousticTonePattern"))
p.write_text(t, encoding="utf-8")
print("final count", t.count("acousticTonePattern"))
