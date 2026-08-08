# Use the official Python 3.11 image
FROM python:3.11

# Create a non-root user (Hugging Face requirement for security)
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Set the working directory
WORKDIR /app

# Copy the backend code into the container
# We change ownership to the non-root user
COPY --chown=user backend/ /app/

# Install Python dependencies
# We use --no-cache-dir to keep the container lightweight
RUN pip install --no-cache-dir -r requirements.txt

# Hugging Face Spaces run on port 7860
EXPOSE 7860

# Start the FastAPI server using Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
