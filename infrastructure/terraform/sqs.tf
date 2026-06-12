# ==========================================
# 1. STANDARD SQS QUEUE & DLQ
# ==========================================

# Standard Dead Letter Queue
resource "aws_sqs_queue" "standard_dlq" {
  name                      = "${local.name_prefix}-standard-dlq"
  message_retention_seconds = 1209600 # 14 days
}

# Standard Queue
resource "aws_sqs_queue" "standard_queue" {
  name                      = "${local.name_prefix}-standard-queue"
  delay_seconds             = 0
  max_message_size          = 262144 # 256 KB
  message_retention_seconds = 345600 # 4 days
  receive_wait_time_seconds = 10     # Long polling enabled

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.standard_dlq.arn
    maxReceiveCount     = 5 # Move to DLQ after 5 failed deliveries
  })
}

# ==========================================
# 2. FIFO SQS QUEUE & DLQ (For strict ordered processing)
# ==========================================

# FIFO Dead Letter Queue
resource "aws_sqs_queue" "fifo_dlq" {
  name                      = "${local.name_prefix}-ordered-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 1209600
}

# FIFO Queue
resource "aws_sqs_queue" "fifo_queue" {
  name                        = "${local.name_prefix}-ordered-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  max_message_size            = 262144
  message_retention_seconds   = 345600
  receive_wait_time_seconds   = 10

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.fifo_dlq.arn
    maxReceiveCount     = 5
  })
}
