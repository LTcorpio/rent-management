// Package jsonx 提供保持插入顺序的 JSON 对象（Go 标准库 map 序列化会按 key 排序，
// 而原 Node 版响应中的楼层分组对象依赖插入顺序，前端楼层 Tab 顺序由此决定）。
package jsonx

import (
	"bytes"
	"encoding/json"
)

// OrderedMap 是一个按插入顺序序列化的 JSON 对象。
type OrderedMap[T any] struct {
	keys []string
	vals map[string]T
}

// New 创建空的有序对象。
func New[T any]() *OrderedMap[T] {
	return &OrderedMap[T]{vals: make(map[string]T)}
}

// Set 写入键值：键已存在则覆盖（保持原位置），否则追加到末尾。
func (m *OrderedMap[T]) Set(key string, val T) {
	if _, ok := m.vals[key]; !ok {
		m.keys = append(m.keys, key)
	}
	m.vals[key] = val
}

// Get 读取键值。
func (m *OrderedMap[T]) Get(key string) (T, bool) {
	v, ok := m.vals[key]
	return v, ok
}

// Keys 按插入顺序返回全部键。
func (m *OrderedMap[T]) Keys() []string {
	return m.keys
}

// Len 返回键数量。
func (m *OrderedMap[T]) Len() int {
	return len(m.keys)
}

// AppendTo 向有序对象中的分组列表追加元素（分组不存在则新建）。
func AppendTo[T any](m *OrderedMap[[]T], key string, val T) {
	list, _ := m.Get(key)
	m.Set(key, append(list, val))
}

// MarshalJSON 按插入顺序输出对象。
func (m *OrderedMap[T]) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range m.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := json.Marshal(m.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}
