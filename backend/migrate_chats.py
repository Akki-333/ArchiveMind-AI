import uuid
import datetime
from database import neo4j_driver

def migrate():
    with neo4j_driver.session() as session:
        # Find all users who have messages directly attached to them
        result = session.run("MATCH (u:User)-[r:HAS_MESSAGE]->(m:Message) RETURN DISTINCT u.username AS username")
        usernames = [record["username"] for record in result]
        
        for username in usernames:
            session_id = str(uuid.uuid4())
            ts = int(datetime.datetime.now().timestamp() * 1000)
            
            # Create a Legacy Chat session for this user
            session.run("""
                MATCH (u:User {username: $username})
                CREATE (u)-[:HAS_SESSION]->(s:ChatSession {id: $session_id, title: 'Legacy Chat', created_at: $ts})
            """, username=username, session_id=session_id, ts=ts)
            
            # Move all HAS_MESSAGE relationships from User to the new ChatSession
            session.run("""
                MATCH (u:User {username: $username})-[r:HAS_MESSAGE]->(m:Message)
                MATCH (u)-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                CREATE (s)-[:HAS_MESSAGE]->(m)
                DELETE r
            """, username=username, session_id=session_id)
            print(f"Migrated messages for user {username} to session {session_id}")

if __name__ == "__main__":
    migrate()
    print("Migration complete!")
