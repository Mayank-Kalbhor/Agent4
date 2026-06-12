output "vpc_id" {
  description = "The ID of the VPC"
  value       = aws_vpc.main.id
}

output "eks_cluster_name" {
  description = "The name of the EKS cluster"
  value       = aws_eks_cluster.this.name
}

output "eks_cluster_endpoint" {
  description = "The endpoint for the EKS Kubernetes API server"
  value       = aws_eks_cluster.this.endpoint
}

output "rds_endpoint" {
  description = "The endpoint of the RDS PostgreSQL database"
  value       = aws_db_instance.postgres.endpoint
}

output "redis_endpoint" {
  description = "The primary endpoint address for ElastiCache Redis"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "sqs_queue_url" {
  description = "The URL of the standard SQS queue"
  value       = aws_sqs_queue.standard_queue.id
}

output "sqs_fifo_queue_url" {
  description = "The URL of the FIFO SQS queue"
  value       = aws_sqs_queue.fifo_queue.id
}
