"""HTTP routers.

`querying.py` had grown to 1,300 lines covering five unrelated concerns:
documents, conversations, chat, comparison and analytics. Splitting it is
purely a maintainability change - every path, payload and response is
identical, and `querying.py` remains as the aggregator so nothing importing it
had to change.
"""
