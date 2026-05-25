package order

import "time"

type Order struct {
	ID        uint      `gorm:"primaryKey"`
	UserID    int64     `gorm:"column:user_id;not null"`
	Amount    int64     `gorm:"not null"`
	Status    string    `gorm:"size:32;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Order) TableName() string {
	return "orders"
}
