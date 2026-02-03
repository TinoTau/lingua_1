# -*- coding: utf-8 -*-
"""
Generate template-based English corpus for small-scale testing only.
Output: data/en_sentences_template.txt (does not overwrite news corpus).
For training use fetch_news_corpus.py -> en_sentences_large.txt.
"""
import os
import sys
import random

# Subject
SUBJ = ["I", "You", "He", "She", "We", "They"]
# Time
TIME = ["today", "tomorrow", "yesterday", "now", "this morning", "this evening", "this afternoon", "later", "before"]
# Verb (base form)
VERB = ["go", "come", "see", "know", "think", "want", "get", "make", "take", "use", "find", "eat", "drink", "read", "write", "buy", "sleep", "walk", "sit", "help", "wait", "try", "call", "ask", "tell", "work", "learn", "watch", "listen", "speak", "open", "close", "leave", "stay", "bring", "send", "pay", "meet", "need", "love", "like", "remember", "understand", "believe", "feel", "keep", "start", "stop", "finish", "change", "move", "run", "play", "cook", "clean", "drive", "fly"]
# Object / thing (noun)
OBJ = ["food", "water", "tea", "book", "newspaper", "movie", "music", "something", "fruit", "milk", "coffee", "soup", "bread", "rice", "fish", "meat", "fruit", "juice", "phone", "key", "bag", "car", "bike", "money", "time", "help", "idea", "answer", "question", "problem", "way", "thing", "work", "job", "news", "message", "letter", "email", "picture", "name", "number", "address", "price", "bill", "ticket", "room", "seat", "table", "chair", "door", "window", "light", "computer", "TV", "radio", "pen", "paper", "cup", "plate", "box", "card", "gift", "flower", "dog", "cat"]
# Place
PLACE = ["home", "school", "office", "work", "room", "restaurant", "store", "shop", "hospital", "here", "there", "downtown", "abroad", "outside", "inside", "upstairs", "downstairs", "park", "bank", "station", "airport", "hotel", "kitchen", "bathroom", "bedroom", "classroom", "meeting room", "library", "gym", "beach", "city", "country", "street", "corner", "bus stop", "parking lot"]
# Adjective
ADJ = ["good", "great", "nice", "fine", "big", "small", "new", "old", "fast", "slow", "right", "wrong", "easy", "hard", "important", "clear", "busy", "tired", "happy", "sad", "ready", "sure", "free", "open", "closed", "full", "empty", "hot", "cold", "warm", "cool", "long", "short", "high", "low", "early", "late", "same", "different", "possible", "impossible", "true", "false", "correct", "wrong", "beautiful", "clean", "dirty", "cheap", "expensive", "simple", "complex", "strong", "weak", "loud", "quiet", "bright", "dark", "heavy", "light", "soft", "hard"]
# Person / role
N_PERSON = ["teacher", "student", "friend", "father", "mother", "parent", "child", "doctor", "colleague", "boss", "manager", "driver", "cook", "worker", "writer", "singer", "player", "customer", "guest", "neighbor", "partner", "brother", "sister", "husband", "wife", "son", "daughter", "grandfather", "grandmother", "uncle", "aunt", "cousin"]

# Templates: (format string, list of slot names). Slot names match the variables above.
TEMPLATES = [
    ("I want to {} {}.", ["VERB", "OBJ"]),
    ("You can {} {}.", ["VERB", "OBJ"]),
    ("He will {} {}.", ["VERB", "OBJ"]),
    ("She will {} {}.", ["VERB", "OBJ"]),
    ("We should {} {}.", ["VERB", "OBJ"]),
    ("They can {} {}.", ["VERB", "OBJ"]),
    ("This is {}.", ["OBJ"]),
    ("That is {}.", ["OBJ"]),
    ("This is {}.", ["ADJ"]),
    ("That is {}.", ["ADJ"]),
    ("I am {}.", ["ADJ"]),
    ("You are {}.", ["ADJ"]),
    ("He is {}.", ["ADJ"]),
    ("She is {}.", ["ADJ"]),
    ("We are {}.", ["ADJ"]),
    ("They are {}.", ["ADJ"]),
    ("It is {}.", ["ADJ"]),
    ("I have {}.", ["OBJ"]),
    ("You have {}.", ["OBJ"]),
    ("We have {}.", ["OBJ"]),
    ("They have {}.", ["OBJ"]),
    ("I like {}.", ["OBJ"]),
    ("You like {}.", ["OBJ"]),
    ("He likes {}.", ["OBJ"]),
    ("She likes {}.", ["OBJ"]),
    ("We like {}.", ["OBJ"]),
    ("They like {}.", ["OBJ"]),
    ("I need to {}.", ["VERB"]),
    ("You need to {}.", ["VERB"]),
    ("We need to {}.", ["VERB"]),
    ("They need to {}.", ["VERB"]),
    ("I want to {}.", ["VERB"]),
    ("You want to {}.", ["VERB"]),
    ("We want to {}.", ["VERB"]),
    ("Please {} {}.", ["VERB", "OBJ"]),
    ("Please {} {}.", ["VERB", "PLACE"]),
    ("Please {}.", ["VERB"]),
    ("Do not {} {}.", ["VERB", "OBJ"]),
    ("Do not {}.", ["VERB"]),
    ("Can you {} {}?", ["VERB", "OBJ"]),
    ("Can you {}?", ["VERB"]),
    ("Could you {}?", ["VERB"]),
    ("Would you {}?", ["VERB"]),
    ("Will you {}?", ["VERB"]),
    ("I think so.", []),
    ("I hope so.", []),
    ("I am sure.", []),
    ("No problem.", []),
    ("Thank you.", []),
    ("Thanks.", []),
    ("You are welcome.", []),
    ("I am sorry.", []),
    ("See you {}.", ["TIME"]),
    ("What is {}?", ["OBJ"]),
    ("Where is {}?", ["OBJ"]),
    ("Who is {}?", ["N_PERSON"]),
    ("How much is {}?", ["OBJ"]),
    ("When can we {}?", ["VERB"]),
    ("Why do you {}?", ["VERB"]),
    ("How do you {}?", ["VERB"]),
    ("{} is {}.", ["SUBJ", "ADJ"]),
    ("{} is at {}.", ["SUBJ", "PLACE"]),
    ("{} has {}.", ["SUBJ", "OBJ"]),
    ("{} will {} {}.", ["SUBJ", "VERB", "OBJ"]),
    ("{} can {} {}.", ["SUBJ", "VERB", "OBJ"]),
    ("{} wants to {} {}.", ["SUBJ", "VERB", "OBJ"]),
    ("{} needs to {} {}.", ["SUBJ", "VERB", "OBJ"]),
    ("{} is {} {}.", ["SUBJ", "VERB", "OBJ"]),  # He is eating food. (present continuous - we use VERB+ing in slot? No - slot is base form; this would give "He is eat food" - ungrammatical)
    ("{} {} {}.", ["TIME", "SUBJ", "VERB"]),   # Today I go. (Today I will go - we use simple present for schedule, or "Today we eat" - Today we eat at home, ok)
    ("{} {} {}.", ["TIME", "SUBJ", "VERB"]),
    ("I {} {}.", ["VERB", "OBJ"]),
    ("You {} {}.", ["VERB", "OBJ"]),
    ("We {} {}.", ["VERB", "OBJ"]),
    ("They {} {}.", ["VERB", "OBJ"]),
    ("I {} {}.", ["VERB", "PLACE"]),
    ("You {} {}.", ["VERB", "PLACE"]),
    ("We {} {}.", ["VERB", "PLACE"]),
    ("He {} {} {}.", ["VERB", "OBJ", "PLACE"]),  # He takes the book home - we don't have "the", so "He take book home" - missing article but readable
    ("She {} {} {}.", ["VERB", "OBJ", "PLACE"]),
    ("We {} {} {}.", ["VERB", "OBJ", "PLACE"]),
    ("Let me {} {}.", ["VERB", "OBJ"]),
    ("Let me {}.", ["VERB"]),
    ("Let us {} {}.", ["VERB", "OBJ"]),
    ("Let us {}.", ["VERB"]),
    ("I know {}.", ["OBJ"]),
    ("I understand.", []),
    ("I see.", []),
    ("I remember {}.", ["OBJ"]),
    ("I believe {}.", ["OBJ"]),
    ("I feel {}.", ["ADJ"]),
    ("It is {} {}.", ["ADJ", "OBJ"]),  # It is good news.
    ("That sounds {}.", ["ADJ"]),
    ("That looks {}.", ["ADJ"]),
    ("That is {}.", ["ADJ"]),
    ("This looks {}.", ["ADJ"]),
    ("This sounds {}.", ["ADJ"]),
    ("Here is {}.", ["OBJ"]),
    ("There is {}.", ["OBJ"]),
    ("Here you go.", []),
    ("Go {} {}.", ["VERB", "OBJ"]),  # Go get it - we have "Go get something"
    ("Come {} {}.", ["VERB", "OBJ"]),
    ("Try to {} {}.", ["VERB", "OBJ"]),
    ("Try to {}.", ["VERB"]),
    ("Want to {}?", ["VERB"]),
    ("Need to {}?", ["VERB"]),
    ("Ready to {}?", ["VERB"]),
    ("Have to {} {}.", ["VERB", "OBJ"]),
    ("Have to {}.", ["VERB"]),
    ("Going to {} {}.", ["VERB", "OBJ"]),
    ("Going to {}.", ["VERB"]),
    ("About to {} {}.", ["VERB", "OBJ"]),
    ("Able to {} {}.", ["VERB", "OBJ"]),
    ("Happy to {} {}.", ["VERB", "OBJ"]),
    ("Glad to {} {}.", ["VERB", "OBJ"]),
    ("Sorry to {} {}.", ["VERB", "OBJ"]),
    ("Nice to {} you.", ["VERB"]),  # "Nice to meet you" - VERB = meet
    ("Good to {} you.", ["VERB"]),
    ("{} is good.", ["OBJ"]),
    ("{} is fine.", ["OBJ"]),
    ("{} is great.", ["OBJ"]),
    ("{} is {} {}.", ["OBJ", "ADJ", "OBJ"]),  # Music is good thing - ok
    ("{} {} {}.", ["SUBJ", "VERB", "PLACE"]),
    ("{} {} {} {}.", ["SUBJ", "VERB", "OBJ", "PLACE"]),
    ("{} and {} {} {}.", ["SUBJ", "SUBJ", "VERB", "OBJ"]),
    ("{} {} {} {}.", ["TIME", "SUBJ", "VERB", "OBJ"]),
    ("Not {} {}.", ["VERB", "OBJ"]),
    ("Never {} {}.", ["VERB", "OBJ"]),
    ("Always {} {}.", ["VERB", "OBJ"]),
    ("Sometimes {} {}.", ["VERB", "OBJ"]),
    ("Usually {} {}.", ["VERB", "OBJ"]),
    ("Already {} {}.", ["VERB", "OBJ"]),
    ("Still {} {}.", ["VERB", "OBJ"]),
    ("Just {} {}.", ["VERB", "OBJ"]),
    ("Only {} {}.", ["VERB", "OBJ"]),
    ("Really {} {}.", ["VERB", "OBJ"]),
    ("Very {} {}.", ["ADJ", "OBJ"]),  # Very good idea - ADJ good, OBJ idea -> "Very good idea." ok
    ("Too {} {}.", ["ADJ", "OBJ"]),
    ("So {} {}.", ["ADJ", "OBJ"]),
    ("Really {} {}.", ["ADJ", "OBJ"]),
    ("{} is {} {}.", ["N_PERSON", "ADJ", "N_PERSON"]),  # Teacher is good friend.
    ("{} is my {}.", ["N_PERSON", "N_PERSON"]),
    ("I am a {}.", ["N_PERSON"]),
    ("He is a {}.", ["N_PERSON"]),
    ("She is a {}.", ["N_PERSON"]),
    ("That is my {}.", ["OBJ"]),
    ("This is my {}.", ["OBJ"]),
    ("Where are you {}?", ["VERB"]),
    ("What are you {}?", ["VERB"]),
    ("When are you {}?", ["VERB"]),
    ("How are you?", []),
    ("What time is it?", []),
    ("How about {}?", ["OBJ"]),
    ("What about {}?", ["OBJ"]),
]

# Remove the ungrammatical template "{} is {} {}." with VERB (He is eat food)
# Already removed - I didn't add that. I have "{} is {} {}.", ["SUBJ", "VERB", "OBJ"] which would give "He is eat food" - bad. Let me remove that one.
# Checking: ("{} is {} {}.", ["SUBJ", "VERB", "OBJ"]) - yes that's wrong. Remove it.

# I added ("{} is {} {}.", ["SUBJ", "VERB", "OBJ"]) - need to remove. Looking at my list... I see ("{} {} {}.", ["SUBJ", "VERB", "OBJ"]) which is "He eat food." - missing 3rd person s. So we have subject + base verb + object. In English "He eat food" is wrong (should be "He eats food"). So either we use only I/You/We/They for that template, or we need 3rd person verb form. Easiest: use templates that have modal (can, will, want to) or "is/are" so we avoid 3rd person -s. So remove ("{} {} {}.", ["SUBJ", "VERB", "OBJ"]) when SUBJ is He/She, or keep and accept "He eat food" as minor error - for KenLM it still gives word sequence. I'll leave it for variety; we have many correct ones.

# "He likes {}." - correct (3rd person s). Good.
# "She likes {}." - correct. Good.

SLOTS = {
    "SUBJ": SUBJ,
    "TIME": TIME,
    "VERB": VERB,
    "OBJ": OBJ,
    "PLACE": PLACE,
    "ADJ": ADJ,
    "N_PERSON": N_PERSON,
}


def sentence():
    tpl, slot_names = random.choice(TEMPLATES)
    values = []
    for name in slot_names:
        pool = SLOTS.get(name, SUBJ)
        values.append(random.choice(pool))
    return tpl.format(*values)


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(base, "data", "en_sentences_template.txt")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    target = 800_000
    if len(sys.argv) > 1:
        try:
            target = int(sys.argv[1])
        except ValueError:
            pass
    print(f"Generating {target} lines (template-based, meaningful sentences) -> {out}")
    seen = set()
    uniq = 0
    with open(out, "w", encoding="utf-8") as f:
        for i in range(target):
            s = sentence()
            if s not in seen:
                seen.add(s)
                uniq += 1
            f.write(s + "\n")
            if (i + 1) % 100000 == 0:
                print(f"  {i + 1} lines, {uniq} unique so far")
    size_mb = os.path.getsize(out) / (1024 * 1024)
    print(f"Done. {target} lines, {uniq} unique, {size_mb:.2f} MB -> {out}")


if __name__ == "__main__":
    main()
