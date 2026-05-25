package order

import "gorm.io/gorm"

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindByID(id string) (*Order, error) {
	var o Order
	if err := r.db.First(&o, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) Insert(o *Order) (*Order, error) {
	if err := r.db.Create(o).Error; err != nil {
		return nil, err
	}
	return o, nil
}
