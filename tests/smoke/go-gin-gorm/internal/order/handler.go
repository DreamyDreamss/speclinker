package order

import (
	"net/http"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(r *gin.RouterGroup) {
	r.GET("/orders/:id", h.GetOrder)
	r.POST("/orders", h.CreateOrder)
}

func (h *Handler) GetOrder(c *gin.Context) {
	id := c.Param("id")
	out, err := h.svc.FindByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateOrder(c *gin.Context) {
	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, _ := h.svc.Create(body)
	c.JSON(http.StatusCreated, out)
}
